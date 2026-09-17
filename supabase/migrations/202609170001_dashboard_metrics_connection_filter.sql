begin;

-- get_dashboard_metrics aggregated across every connection (WhatsApp instance) owned by the
-- organization, with no way to scope to one. The dashboard UI only ever has one instance
-- selected/connected at a time, so this made every metric look like a cross-instance rollup.
-- Adds an optional p_connection_id: null keeps the previous org-wide behavior, a uuid scopes
-- conv_in_range/exec_in_range (and therefore every CTE built on top of them) to that instance.

drop function if exists public.get_dashboard_metrics(uuid, date, date);

create or replace function public.get_dashboard_metrics(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date,
  p_connection_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if p_end_date < p_start_date then
    raise exception 'end_date must not be before start_date' using errcode = '22023';
  end if;
  if p_end_date - p_start_date > 366 then
    raise exception 'date range must not exceed 366 days' using errcode = '22023';
  end if;

  v_start := (p_start_date::timestamp at time zone 'UTC');
  v_end := ((p_end_date + 1)::timestamp at time zone 'UTC');

  with conv_in_range as (
    select c.id, c.stage, c.handled_by, c.flow_version_id, c.created_at
    from public.conversations c
    where c.organization_id = p_organization_id
      and c.created_at >= v_start and c.created_at < v_end
      and (p_connection_id is null or c.connection_id = p_connection_id)
  ),
  exec_in_range as (
    select e.id, e.flow_version_id, e.input_tokens, e.output_tokens, e.created_at
    from public.flow_executions e
    where e.organization_id = p_organization_id
      and e.created_at >= v_start and e.created_at < v_end
      and (p_connection_id is null or e.connection_id = p_connection_id)
  ),
  totals as (
    select
      count(*)::int as total_conversations,
      count(*) filter (where stage in ('PRESENTING_SOLUTION','NEGOTIATING','CONVERTED'))::int as qualified_conversations,
      count(*) filter (where stage = 'HUMAN_HANDOFF' or handled_by = 'HUMAN')::int as handoff_conversations
    from conv_in_range
  ),
  exec_totals as (
    select coalesce(sum(input_tokens),0)::bigint as in_tok, coalesce(sum(output_tokens),0)::bigint as out_tok
    from exec_in_range
  ),
  funnel_canonical as (
    select s.stage::text as stage, s.ord, count(cr.id)::int as cnt
    from unnest(enum_range(null::public.conversation_stage)) with ordinality as s(stage, ord)
    left join conv_in_range cr on cr.stage = s.stage
    group by s.stage, s.ord
  ),
  conv_by_version as (
    select flow_version_id,
      count(*)::int as conversations_count,
      count(*) filter (where stage in ('PRESENTING_SOLUTION','NEGOTIATING','CONVERTED'))::int as qualified_count
    from conv_in_range
    where flow_version_id is not null
    group by flow_version_id
  ),
  exec_by_version as (
    select flow_version_id, coalesce(sum(input_tokens + output_tokens),0)::bigint as tokens
    from exec_in_range
    where flow_version_id is not null
    group by flow_version_id
  ),
  frt_pairs as (
    select fi.conversation_id, min(fo.out_time) as out_time, fi.in_time
    from (
      select m.conversation_id, min(m.created_at) as in_time
      from public.messages m
      join conv_in_range cr on cr.id = m.conversation_id
      where m.organization_id = p_organization_id and m.direction = 'INBOUND'
      group by m.conversation_id
    ) fi
    join (
      select m.conversation_id, m.created_at as out_time
      from public.messages m
      join conv_in_range cr on cr.id = m.conversation_id
      where m.organization_id = p_organization_id and m.direction = 'OUTBOUND'
    ) fo on fo.conversation_id = fi.conversation_id
    where fo.out_time > fi.in_time
    group by fi.conversation_id, fi.in_time
  ),
  frt as (
    select coalesce(avg(extract(epoch from (out_time - in_time))), 0)::float as avg_sec
    from frt_pairs
  ),
  daily_conv as (
    select (date_trunc('day', created_at at time zone 'UTC'))::date as day,
      count(*)::int as conversations,
      count(*) filter (where stage in ('PRESENTING_SOLUTION','NEGOTIATING','CONVERTED'))::int as qualified,
      count(*) filter (where stage = 'HUMAN_HANDOFF' or handled_by = 'HUMAN')::int as handoff
    from conv_in_range
    group by 1
  ),
  daily_exec as (
    select (date_trunc('day', created_at at time zone 'UTC'))::date as day,
      coalesce(sum(input_tokens + output_tokens),0)::bigint as tokens
    from exec_in_range
    group by 1
  ),
  daily as (
    select coalesce(dc.day, de.day) as day,
      coalesce(dc.conversations,0) as conversations,
      coalesce(dc.qualified,0) as qualified,
      coalesce(dc.handoff,0) as handoff,
      coalesce(de.tokens,0) as tokens
    from daily_conv dc
    full outer join daily_exec de on de.day = dc.day
  )
  select jsonb_build_object(
    'totalConversations', t.total_conversations,
    'newConversations', t.total_conversations,
    'qualifiedConversations', t.qualified_conversations,
    'qualificationRate', case when t.total_conversations > 0 then round((t.qualified_conversations::numeric / t.total_conversations) * 1000) / 10 else 0 end,
    'handoffConversations', t.handoff_conversations,
    'avgFirstResponseTimeSec', round((select avg_sec from frt)::numeric, 1),
    'totalTokens', et.in_tok + et.out_tok,
    'totalEstimatedCost', round(((et.in_tok * 0.0000015) + (et.out_tok * 0.0000020))::numeric, 4),
    'costPerQualifiedLead', case when t.qualified_conversations > 0
      then round((((et.in_tok * 0.0000015) + (et.out_tok * 0.0000020)) / t.qualified_conversations)::numeric, 3)
      else 0 end,
    'funnel', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'stage', fc.stage,
        'count', fc.cnt,
        'percentage', case when t.total_conversations > 0 then round((fc.cnt::numeric / t.total_conversations) * 1000) / 10 else 0 end
      ) order by fc.ord), '[]'::jsonb)
      from funnel_canonical fc
    ),
    'flowComparison', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'flowVersionId', fv.id,
        'flowName', f.name,
        'version', fv.version,
        'conversationsCount', coalesce(cbv.conversations_count, 0),
        'qualifiedCount', coalesce(cbv.qualified_count, 0),
        'qualificationRate', case when coalesce(cbv.conversations_count,0) > 0
          then round((coalesce(cbv.qualified_count,0)::numeric / cbv.conversations_count) * 1000) / 10 else 0 end,
        'avgResponseTimeSec', round((select avg_sec from frt)::numeric, 1),
        'totalTokens', coalesce(ebv.tokens, 0),
        'totalCost', round((coalesce(ebv.tokens, 0) * 0.0000017)::numeric, 4)
      ) order by f.name asc, fv.version desc), '[]'::jsonb)
      from public.flow_versions fv
      join public.flows f on f.id = fv.flow_id
      left join conv_by_version cbv on cbv.flow_version_id = fv.id
      left join exec_by_version ebv on ebv.flow_version_id = fv.id
      where fv.organization_id = p_organization_id
        and (cbv.flow_version_id is not null or ebv.flow_version_id is not null)
    ),
    'dailyTrends', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'conversations', d.conversations,
        'qualified', d.qualified,
        'handoff', d.handoff,
        'tokens', d.tokens,
        'cost', round((d.tokens * 0.0000017)::numeric, 4)
      ) order by d.day), '[]'::jsonb)
      from daily d
    )
  ) into v_result
  from totals t, exec_totals et;

  return v_result;
end $$;

revoke all on function public.get_dashboard_metrics(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.get_dashboard_metrics(uuid, date, date, uuid) to service_role, authenticated;

commit;

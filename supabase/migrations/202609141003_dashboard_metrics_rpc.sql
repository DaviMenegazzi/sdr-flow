begin;

-- Phase 4 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 10): dashboard metrics computed in
-- Postgres instead of the API loading every conversation into Node. Replaces
-- MetricsRepository's Supabase-JS fallback (which ignored startDate/endDate entirely and
-- hardcoded avgFirstResponseTimeSec to 4.2) and fixes a confirmed cartesian-fanout bug in the
-- flow-version comparison: LEFT JOINing conversations and flow_executions on flow_version_id
-- independently multiplies token sums by conversation count (reproduced and measured in
-- scripts/benchmark-metrics.ts — it overflows int4 outright at realistic volume, not just wrong
-- numbers). Conversations and executions are aggregated in separate CTEs here before any join.
--
-- Interval semantics (10.2): [p_start_date, p_end_date + 1 day) in UTC, regardless of session
-- timezone — every boundary below casts the date to a naive timestamp and reinterprets it AT
-- TIME ZONE 'UTC', never relying on the session's own timezone setting.

create or replace function public.get_dashboard_metrics(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date
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
  ),
  exec_in_range as (
    select e.id, e.flow_version_id, e.input_tokens, e.output_tokens, e.created_at
    from public.flow_executions e
    where e.organization_id = p_organization_id
      and e.created_at >= v_start and e.created_at < v_end
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
    -- WITH ORDINALITY preserves the enum's declared pipeline order (NEW_CONVERSATION ->
    -- ... -> CLOSED); GROUP BY alone does not guarantee that order downstream, and an
    -- alphabetical ORDER BY stage would scramble it (CLOSED would sort before
    -- NEW_CONVERSATION).
    select s.stage::text as stage, s.ord, count(cr.id)::int as cnt
    from unnest(enum_range(null::public.conversation_stage)) with ordinality as s(stage, ord)
    left join conv_in_range cr on cr.stage = s.stage
    group by s.stage, s.ord
  ),
  -- Aggregate conversations and executions independently per flow_version_id BEFORE any join —
  -- the fix for the fanout bug described above.
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

revoke all on function public.get_dashboard_metrics(uuid, date, date) from public, anon, authenticated;
grant execute on function public.get_dashboard_metrics(uuid, date, date) to service_role, authenticated;

-- Indexes justified by the query shapes above (10.3.8-9): range predicates on created_at
-- without wrapping it in a function, so these can actually be used for the >= / < bounds.
create index if not exists conversations_org_created_flowver_idx
  on public.conversations(organization_id, created_at, flow_version_id);
create index if not exists flow_executions_org_created_flowver_idx
  on public.flow_executions(organization_id, created_at, flow_version_id);
create index if not exists messages_org_conversation_direction_time_idx
  on public.messages(organization_id, conversation_id, direction, created_at);

commit;

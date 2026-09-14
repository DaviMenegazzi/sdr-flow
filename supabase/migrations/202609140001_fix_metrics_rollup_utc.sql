-- Keep daily metrics aligned with the ISO-8601 dates used by the API.
-- PostgreSQL casts timestamptz to date in the session timezone; that caused
-- records around midnight in Brazil to be rolled into the previous day.
create or replace function public.rollup_metrics_daily(
  p_org uuid,
  p_target_date date,
  p_flow_version uuid default null
) returns public.metrics_daily
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.metrics_daily;
  v_total int;
  v_new int;
  v_qual int;
  v_handoff int;
  v_stages jsonb;
  v_avg_frt int;
  v_in_tokens int;
  v_out_tokens int;
  v_cost numeric(10, 4);
  v_flow_id uuid;
begin
  if p_flow_version is not null then
    select flow_id into v_flow_id from public.flow_versions where id = p_flow_version and organization_id = p_org;
  end if;

  select count(*),
    count(*) filter (where (c.created_at at time zone 'UTC')::date = p_target_date),
    count(*) filter (where c.stage::text in ('QUALIFIED', 'PRESENTING_SOLUTION', 'NEGOTIATING', 'CONVERTED')),
    count(*) filter (where c.stage::text in ('HANDOFF', 'HUMAN_HANDOFF') or c.handled_by = 'HUMAN')
  into v_total, v_new, v_qual, v_handoff
  from public.conversations c
  where c.organization_id = p_org
    and (p_flow_version is null or c.flow_version_id = p_flow_version)
    and ((c.created_at at time zone 'UTC')::date = p_target_date or (c.updated_at at time zone 'UTC')::date = p_target_date);

  select coalesce(jsonb_object_agg(sub.stage::text, sub.cnt), '{}'::jsonb) into v_stages
  from (
    select c.stage, count(*)::int as cnt
    from public.conversations c
    where c.organization_id = p_org
      and (p_flow_version is null or c.flow_version_id = p_flow_version)
      and ((c.created_at at time zone 'UTC')::date = p_target_date or (c.updated_at at time zone 'UTC')::date = p_target_date)
    group by c.stage
  ) sub;

  with first_inbound as (
    select m.conversation_id, min(m.created_at) as in_time
    from public.messages m
    where m.organization_id = p_org and m.direction = 'INBOUND'
      and (m.created_at at time zone 'UTC')::date = p_target_date
    group by m.conversation_id
  ), first_outbound as (
    select m.conversation_id, min(m.created_at) as out_time
    from public.messages m join first_inbound fi on fi.conversation_id = m.conversation_id
    where m.organization_id = p_org and m.direction = 'OUTBOUND' and m.created_at > fi.in_time
    group by m.conversation_id
  )
  select coalesce(avg(extract(epoch from (fo.out_time - fi.in_time)) * 1000)::int, 0)
  into v_avg_frt from first_inbound fi join first_outbound fo on fo.conversation_id = fi.conversation_id;

  select coalesce(sum(e.input_tokens), 0)::int, coalesce(sum(e.output_tokens), 0)::int
  into v_in_tokens, v_out_tokens
  from public.flow_executions e
  where e.organization_id = p_org and (p_flow_version is null or e.flow_version_id = p_flow_version)
    and (e.created_at at time zone 'UTC')::date = p_target_date;

  v_cost := round(((v_in_tokens::numeric * 0.0000015) + (v_out_tokens::numeric * 0.0000020)), 4);

  insert into public.metrics_daily (
    organization_id, metric_date, flow_id, flow_version_id, total_conversations,
    new_conversations, qualified_conversations, handoff_conversations, stage_counts,
    avg_first_response_time_ms, total_input_tokens, total_output_tokens,
    estimated_token_cost, updated_at
  ) values (
    p_org, p_target_date, v_flow_id, p_flow_version, coalesce(v_total, 0), coalesce(v_new, 0),
    coalesce(v_qual, 0), coalesce(v_handoff, 0), coalesce(v_stages, '{}'::jsonb),
    coalesce(v_avg_frt, 0), v_in_tokens, v_out_tokens, v_cost, now()
  )
  on conflict (organization_id, metric_date, coalesce(flow_version_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set flow_id = excluded.flow_id, total_conversations = excluded.total_conversations,
    new_conversations = excluded.new_conversations, qualified_conversations = excluded.qualified_conversations,
    handoff_conversations = excluded.handoff_conversations, stage_counts = excluded.stage_counts,
    avg_first_response_time_ms = excluded.avg_first_response_time_ms,
    total_input_tokens = excluded.total_input_tokens, total_output_tokens = excluded.total_output_tokens,
    estimated_token_cost = excluded.estimated_token_cost, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.rollup_metrics_daily(uuid, date, uuid) from public;
grant execute on function public.rollup_metrics_daily(uuid, date, uuid) to authenticated, service_role;

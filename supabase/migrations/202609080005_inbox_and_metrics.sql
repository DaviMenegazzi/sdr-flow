-- Fase 6: Inbox e Indicadores
-- Estrutura para Atendimento Humano, Métricas em Tempo Real e Consolidação Diária

alter table public.conversations add column if not exists stage_updated_at timestamptz not null default now();

create index if not exists conversations_org_stage_idx on public.conversations (organization_id, stage, last_message_at desc);
create index if not exists conversations_org_assigned_idx on public.conversations (organization_id, assigned_user_id);
create index if not exists conversations_org_handled_idx on public.conversations (organization_id, handled_by, bot_paused);

-- Permite que usuários autenticados da organização atualizem status de conversas (takeover, release, stage, assigned_user)
create policy conversation_update on public.conversations for update to authenticated
  using (private.org_role(organization_id) is not null)
  with check (private.org_role(organization_id) is not null);
grant update (stage, bot_paused, handled_by, assigned_user_id, stage_updated_at, updated_at) on public.conversations to authenticated;

-- Permite que atendentes humanos insiram mensagens manuais
create policy message_insert on public.messages for insert to authenticated
  with check (private.org_role(organization_id) is not null);
grant insert (organization_id, connection_id, conversation_id, sender, direction, content, message_type) on public.messages to authenticated;

-- Tabela de consolidação diária de métricas
create table if not exists public.metrics_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_date date not null,
  flow_id uuid references public.flows(id) on delete set null,
  flow_version_id uuid references public.flow_versions(id) on delete set null,
  total_conversations integer not null default 0 check (total_conversations >= 0),
  new_conversations integer not null default 0 check (new_conversations >= 0),
  qualified_conversations integer not null default 0 check (qualified_conversations >= 0),
  handoff_conversations integer not null default 0 check (handoff_conversations >= 0),
  stage_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(stage_counts) = 'object'),
  avg_first_response_time_ms integer not null default 0 check (avg_first_response_time_ms >= 0),
  total_input_tokens integer not null default 0 check (total_input_tokens >= 0),
  total_output_tokens integer not null default 0 check (total_output_tokens >= 0),
  estimated_token_cost numeric(10, 4) not null default 0 check (estimated_token_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists metrics_daily_org_date_flow_version_idx
  on public.metrics_daily (organization_id, metric_date, coalesce(flow_version_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists metrics_daily_org_date_idx on public.metrics_daily(organization_id, metric_date desc);

alter table public.metrics_daily enable row level security;
create policy metrics_daily_read on public.metrics_daily for select to authenticated
  using (private.org_role(organization_id) is not null);
grant select on public.metrics_daily to authenticated;
grant all on public.metrics_daily to service_role;

-- Função de consolidação diária (executada por worker ou chamada manualmente)
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

  -- Contagens de conversas
  select
    count(*),
    count(*) filter (where c.created_at::date = p_target_date),
    count(*) filter (where c.stage::text in ('QUALIFIED', 'PRESENTING_SOLUTION', 'NEGOTIATING', 'CONVERTED')),
    count(*) filter (where c.stage::text in ('HANDOFF', 'HUMAN_HANDOFF') or c.handled_by = 'HUMAN')
  into v_total, v_new, v_qual, v_handoff
  from public.conversations c
  where c.organization_id = p_org
    and (p_flow_version is null or c.flow_version_id = p_flow_version)
    and (c.created_at::date = p_target_date or c.updated_at::date = p_target_date);

  -- Distribuição por estágios
  select coalesce(jsonb_object_agg(sub.stage::text, sub.cnt), '{}'::jsonb)
  into v_stages
  from (
    select c.stage, count(*)::int as cnt
    from public.conversations c
    where c.organization_id = p_org
      and (p_flow_version is null or c.flow_version_id = p_flow_version)
      and (c.created_at::date = p_target_date or c.updated_at::date = p_target_date)
    group by c.stage
  ) sub;

  -- Tempo médio de primeira resposta (ms)
  with first_inbound as (
    select m.conversation_id, min(m.created_at) as in_time
    from public.messages m
    where m.organization_id = p_org
      and m.direction = 'INBOUND'
      and m.created_at::date = p_target_date
    group by m.conversation_id
  ),
  first_outbound as (
    select m.conversation_id, min(m.created_at) as out_time
    from public.messages m
    join first_inbound fi on fi.conversation_id = m.conversation_id
    where m.organization_id = p_org
      and m.direction = 'OUTBOUND'
      and m.created_at > fi.in_time
    group by m.conversation_id
  )
  select coalesce(avg(extract(epoch from (fo.out_time - fi.in_time)) * 1000)::int, 0)
  into v_avg_frt
  from first_inbound fi
  join first_outbound fo on fo.conversation_id = fi.conversation_id;

  -- Tokens consumidos em execuções de fluxo na data
  select
    coalesce(sum(e.input_tokens), 0)::int,
    coalesce(sum(e.output_tokens), 0)::int
  into v_in_tokens, v_out_tokens
  from public.flow_executions e
  where e.organization_id = p_org
    and (p_flow_version is null or e.flow_version_id = p_flow_version)
    and e.created_at::date = p_target_date;

  -- Custo de tokens estimado ($0.0015 / 1k in, $0.0020 / 1k out)
  v_cost := round(((v_in_tokens::numeric * 0.0000015) + (v_out_tokens::numeric * 0.0000020)), 4);

  -- Upsert
  insert into public.metrics_daily (
    organization_id, metric_date, flow_id, flow_version_id,
    total_conversations, new_conversations, qualified_conversations,
    handoff_conversations, stage_counts, avg_first_response_time_ms,
    total_input_tokens, total_output_tokens, estimated_token_cost,
    updated_at
  ) values (
    p_org, p_target_date, v_flow_id, p_flow_version,
    coalesce(v_total, 0), coalesce(v_new, 0), coalesce(v_qual, 0),
    coalesce(v_handoff, 0), coalesce(v_stages, '{}'::jsonb), coalesce(v_avg_frt, 0),
    v_in_tokens, v_out_tokens, v_cost,
    now()
  )
  on conflict (organization_id, metric_date, coalesce(flow_version_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    total_conversations = excluded.total_conversations,
    new_conversations = excluded.new_conversations,
    qualified_conversations = excluded.qualified_conversations,
    handoff_conversations = excluded.handoff_conversations,
    stage_counts = excluded.stage_counts,
    avg_first_response_time_ms = excluded.avg_first_response_time_ms,
    total_input_tokens = excluded.total_input_tokens,
    total_output_tokens = excluded.total_output_tokens,
    estimated_token_cost = excluded.estimated_token_cost,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.rollup_metrics_daily(uuid, date, uuid) to authenticated, service_role;

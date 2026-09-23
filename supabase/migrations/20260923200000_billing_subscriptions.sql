begin;

-- =============================================================================
-- Billing: assinatura por organização, direito de acesso (entitlement) e limites
-- =============================================================================
--
-- organizations.tier continua sendo lido por apps/api/src/auth.ts, mas passa a ser
-- apenas a PROJEÇÃO do direito efetivo. Somente private.sync_org_entitlement pode
-- alterá-lo; ele deriva o tier de (a) concessão manual auditada ou (b) assinatura
-- confirmada pelo gateway. Nenhum caminho de login, cadastro ou retorno de checkout
-- escreve o tier diretamente.

-- -----------------------------------------------------------------------------
-- 1. Criar login nunca altera o plano da organização
-- -----------------------------------------------------------------------------
-- Até aqui, POST /api/admin/organizations/:id/logins enviava sdr_org_tier e os
-- triggers de provisionamento sobrescreviam organizations.tier. Adicionar um membro
-- a uma organização paga podia rebaixá-la. O campo passa a ser ignorado.
create or replace function private.apply_target_login_provisioning(
  p_user uuid,
  p_email text,
  p_user_metadata jsonb,
  p_app_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_org_text text := nullif(trim(coalesce(p_app_metadata ->> 'sdr_target_organization_id', '')), '');
  v_target_org uuid;
  v_previous_org uuid;
  v_member_role public.member_role;
  v_app_role public.app_role;
  v_actor uuid;
  v_display_name text := nullif(trim(coalesce(p_user_metadata ->> 'display_name', '')), '');
begin
  if v_target_org_text is null then
    return;
  end if;

  begin
    v_target_org := v_target_org_text::uuid;
    v_member_role := coalesce(nullif(p_app_metadata ->> 'sdr_member_role', ''), 'viewer')::public.member_role;
    v_app_role := coalesce(nullif(p_app_metadata ->> 'sdr_app_role', ''), 'client')::public.app_role;
    v_actor := nullif(p_app_metadata ->> 'sdr_provisioned_by', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'Invalid login provisioning metadata' using errcode = '22023';
  end;

  if not exists (select 1 from public.organizations where id = v_target_org) then
    raise exception 'Target organization not found' using errcode = 'P0002';
  end if;

  select default_organization_id
  into v_previous_org
  from public.profiles
  where user_id = p_user;

  insert into public.organization_members(organization_id, user_id, role)
  values (v_target_org, p_user, v_member_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;

  insert into public.profiles(user_id, display_name, role, status, default_organization_id)
  values (p_user, v_display_name, v_app_role, 'active', v_target_org)
  on conflict (user_id) do update
    set display_name = coalesce(excluded.display_name, public.profiles.display_name),
        role = excluded.role,
        status = 'active',
        default_organization_id = excluded.default_organization_id,
        updated_at = now();

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_limits'
      and column_name = 'owner_user_id'
  ) then
    execute
      'insert into public.account_limits(organization_id, owner_user_id) values ($1, $2) on conflict do nothing'
      using v_target_org, p_user;
  else
    insert into public.account_limits(organization_id)
    values (v_target_org)
    on conflict (organization_id) do nothing;
  end if;

  if not exists (
    select 1
    from public.audit_events
    where organization_id = v_target_org
      and action = 'account.login_created'
      and entity_id = p_user
  ) then
    insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
    values (
      v_target_org,
      v_actor,
      'account.login_created',
      p_user,
      jsonb_build_object(
        'email', lower(p_email),
        'app_role', v_app_role,
        'member_role', v_member_role
      )
    );
  end if;

  if v_previous_org is not null and v_previous_org <> v_target_org then
    delete from public.organization_members membership
    where membership.organization_id = v_previous_org
      and membership.user_id = p_user
      and membership.role = 'owner'
      and (
        select count(*)
        from public.organization_members sibling
        where sibling.organization_id = v_previous_org
      ) = 1;
  end if;
end
$$;

revoke all on function private.apply_target_login_provisioning(uuid, text, jsonb, jsonb) from public;

-- -----------------------------------------------------------------------------
-- 2. Tipos
-- -----------------------------------------------------------------------------
create type public.billing_interval as enum ('monthly', 'yearly');
create type public.subscription_status as enum ('pending_payment', 'active', 'past_due', 'suspended', 'canceled', 'expired');
create type public.checkout_intent_status as enum ('open', 'paid', 'expired', 'canceled', 'failed');
create type public.billing_payment_status as enum ('pending', 'confirmed', 'received', 'overdue', 'refunded', 'chargeback', 'canceled');
create type public.entitlement_change_reason as enum (
  'payment', 'renewal', 'upgrade', 'downgrade', 'grace_expired', 'period_ended',
  'refund', 'chargeback', 'manual_grant', 'manual_revoke', 'grant_expired'
);

-- Classificação dos tiers para comparar upgrade/downgrade.
create function private.tier_rank(p_tier public.org_tier) returns integer
language sql immutable set search_path = '' as $$
  select case p_tier when 'pre-venda' then 0 when 'vendedor' then 1 when 'vendedor-senior' then 2 end
$$;

-- Carência após falha de renovação (dias). Espelhado em packages/shared/src/billing.ts.
create function private.billing_grace_days() returns integer
language sql immutable set search_path = '' as $$ select 3 $$;

-- -----------------------------------------------------------------------------
-- 3. Tabelas de negócio (schema public, leitura limitada por RLS, sem escrita pelo navegador)
-- -----------------------------------------------------------------------------
-- Evidência financeira não é apagada em cascata com a organização (on delete restrict).

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null check (provider ~ '^[a-z_]{2,32}$'),
  provider_subscription_id text,
  provider_customer_id text,
  offer_code text not null,
  offer_version integer not null check (offer_version > 0),
  tier public.org_tier not null,
  billing_interval public.billing_interval not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status public.subscription_status not null default 'pending_payment',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  past_due_since timestamptz,
  grace_until timestamptz,
  suspended_reason text,
  scheduled_offer_code text,
  scheduled_offer_version integer,
  scheduled_tier public.org_tier,
  scheduled_amount_cents integer check (scheduled_amount_cents is null or scheduled_amount_cents >= 0),
  latest_payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (provider, provider_subscription_id),
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start)
);
-- Uma assinatura faturável corrente por organização; o histórico fica preservado.
create unique index organization_subscriptions_one_current
  on public.organization_subscriptions(organization_id)
  where status in ('pending_payment', 'active', 'past_due');
create index organization_subscriptions_status_idx on public.organization_subscriptions(organization_id, status);

create table public.checkout_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requested_by_user_id uuid not null,
  kind text not null check (kind in ('new', 'upgrade')),
  subscription_id uuid,
  offer_code text not null,
  offer_version integer not null check (offer_version > 0),
  tier public.org_tier not null,
  billing_interval public.billing_interval not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  provider text not null check (provider ~ '^[a-z_]{2,32}$'),
  provider_checkout_id text,
  checkout_url text check (checkout_url is null or checkout_url ~ '^https://'),
  external_reference text not null unique,
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  status public.checkout_intent_status not null default 'open',
  failure_code text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, requested_by_user_id, idempotency_key),
  unique (provider, provider_checkout_id),
  foreign key (organization_id, subscription_id) references public.organization_subscriptions(organization_id, id)
);
create index checkout_intents_status_idx on public.checkout_intents(organization_id, status);

create table public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subscription_id uuid,
  checkout_intent_id uuid,
  provider text not null check (provider ~ '^[a-z_]{2,32}$'),
  provider_payment_id text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status public.billing_payment_status not null default 'pending',
  billing_type text,
  due_date date,
  paid_at timestamptz,
  refunded_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  invoice_url text check (invoice_url is null or invoice_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (provider, provider_payment_id),
  foreign key (organization_id, subscription_id) references public.organization_subscriptions(organization_id, id),
  foreign key (organization_id, checkout_intent_id) references public.checkout_intents(organization_id, id)
);
create index billing_payments_status_idx on public.billing_payments(organization_id, status);
create index billing_payments_subscription_idx on public.billing_payments(organization_id, subscription_id, created_at desc);

alter table public.organization_subscriptions
  add constraint organization_subscriptions_latest_payment_fk
  foreign key (organization_id, latest_payment_id) references public.billing_payments(organization_id, id);

-- Concessões manuais (cortesia, contrato fora do gateway, contas legadas). Sempre com motivo.
create table public.organization_plan_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tier public.org_tier not null,
  reason text not null check (length(trim(reason)) between 3 and 500),
  granted_by uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index organization_plan_grants_one_active
  on public.organization_plan_grants(organization_id)
  where revoked_at is null;

create table public.billing_entitlement_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  previous_tier public.org_tier not null,
  new_tier public.org_tier not null,
  reason public.entitlement_change_reason not null,
  source text not null check (source in ('subscription', 'grant', 'default')),
  subscription_id uuid,
  payment_id uuid,
  grant_id uuid,
  webhook_event_id uuid,
  actor_user_id uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, subscription_id) references public.organization_subscriptions(organization_id, id),
  foreign key (organization_id, payment_id) references public.billing_payments(organization_id, id),
  foreign key (organization_id, grant_id) references public.organization_plan_grants(organization_id, id)
);
create index billing_entitlement_changes_org_idx on public.billing_entitlement_changes(organization_id, created_at desc);

-- Registro canônico de limites POR ORGANIZAÇÃO. Os valores padrão vêm do tier
-- (private.plan_limits); esta tabela guarda apenas exceções manuais auditadas.
create table public.organization_limits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  override_agents boolean not null default false,
  max_agents integer check (max_agents is null or max_agents between 1 and 1000),
  override_instances boolean not null default false,
  max_instances integer check (max_instances is null or max_instances >= 0),
  reason text not null check (length(trim(reason)) between 3 and 500),
  expires_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Tabelas privadas (fora da Data API): cliente no gateway e inbox de webhooks
-- -----------------------------------------------------------------------------
create table private.billing_customers (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  provider text not null,
  provider_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_customer_id)
);

-- Eventos chegam antes de sabermos a organização: a inbox fica no schema privado e
-- ganha organization_id somente após correlação por referência previamente gravada.
create table private.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'processed', 'ignored', 'unmatched', 'needs_review', 'failed', 'dead')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);
create index billing_webhook_events_queue_idx on private.billing_webhook_events(processing_status, next_attempt_at);

alter table private.billing_customers enable row level security;
alter table private.billing_webhook_events enable row level security;
alter table private.billing_customers force row level security;
alter table private.billing_webhook_events force row level security;
revoke all on private.billing_customers, private.billing_webhook_events from public;
grant all on private.billing_customers, private.billing_webhook_events to service_role;

-- -----------------------------------------------------------------------------
-- 5. RLS e grants explícitos
-- -----------------------------------------------------------------------------
revoke all on public.organization_subscriptions, public.checkout_intents, public.billing_payments,
  public.organization_plan_grants, public.billing_entitlement_changes, public.organization_limits
  from public, anon, authenticated;

alter table public.organization_subscriptions enable row level security;
alter table public.checkout_intents enable row level security;
alter table public.billing_payments enable row level security;
alter table public.organization_plan_grants enable row level security;
alter table public.billing_entitlement_changes enable row level security;
alter table public.organization_limits enable row level security;
alter table public.organization_subscriptions force row level security;
alter table public.checkout_intents force row level security;
alter table public.billing_payments force row level security;
alter table public.organization_plan_grants force row level security;
alter table public.billing_entitlement_changes force row level security;
alter table public.organization_limits force row level security;

-- Dados financeiros: apenas owner e admin da organização leem. Ninguém autenticado escreve.
create policy billing_subscriptions_read on public.organization_subscriptions for select to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin') and private.current_profile_is_active());
create policy billing_checkouts_read on public.checkout_intents for select to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin') and private.current_profile_is_active());
create policy billing_payments_read on public.billing_payments for select to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin') and private.current_profile_is_active());
create policy billing_grants_read on public.organization_plan_grants for select to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin') and private.current_profile_is_active());
create policy billing_changes_read on public.billing_entitlement_changes for select to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin') and private.current_profile_is_active());
-- Limites efetivos interessam a qualquer membro (mensagens de bloqueio na UI).
create policy organization_limits_read on public.organization_limits for select to authenticated
  using (private.org_role(organization_id) is not null and private.current_profile_is_active());

grant select on public.organization_subscriptions, public.checkout_intents, public.billing_payments,
  public.organization_plan_grants, public.billing_entitlement_changes, public.organization_limits
  to authenticated;
grant all on public.organization_subscriptions, public.checkout_intents, public.billing_payments,
  public.organization_plan_grants, public.billing_entitlement_changes, public.organization_limits
  to service_role;

-- -----------------------------------------------------------------------------
-- 6. Limites por plano e limites efetivos
-- -----------------------------------------------------------------------------
-- Espelhado em PLAN_LIMITS (packages/shared/src/billing.ts); tests/billing.test.ts
-- garante que as duas fontes não divergem. null = ilimitado.
create function private.plan_limits(p_tier public.org_tier)
returns table(max_agents integer, max_instances integer)
language sql immutable set search_path = '' as $$
  select l.agents, l.instances from (values
    ('pre-venda'::public.org_tier, 2, 1),
    ('vendedor'::public.org_tier, 5, 3),
    ('vendedor-senior'::public.org_tier, null::integer, null::integer)
  ) as l(tier, agents, instances)
  where l.tier = p_tier
$$;

create function private.effective_limits(p_org uuid)
returns table(max_agents integer, max_instances integer, agents_source text, instances_source text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tier public.org_tier;
  v_plan record;
  v_override public.organization_limits;
begin
  select tier into v_tier from public.organizations where id = p_org;
  select * into v_plan from private.plan_limits(coalesce(v_tier, 'pre-venda'));
  select * into v_override from public.organization_limits
  where organization_id = p_org and (expires_at is null or expires_at > now());

  max_agents := case when v_override.override_agents then v_override.max_agents else v_plan.max_agents end;
  max_instances := case when v_override.override_instances then v_override.max_instances else v_plan.max_instances end;
  agents_source := case when v_override.override_agents then 'override' else 'plan' end;
  instances_source := case when v_override.override_instances then 'override' else 'plan' end;
  return next;
end $$;
revoke all on function private.effective_limits(uuid) from public;
grant execute on function private.effective_limits(uuid) to service_role;

-- Leitura dos limites efetivos pela API do usuário (membro ativo da organização).
create function public.get_organization_limits(p_org uuid)
returns table(max_agents integer, max_instances integer, agents_source text, instances_source text, active_agents integer, instances integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.org_role(p_org) is null or not private.current_profile_is_active() then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  return query
    select l.max_agents, l.max_instances, l.agents_source, l.instances_source,
      (select count(*)::integer from public.ai_agents a where a.organization_id = p_org and a.status = 'active'),
      (select count(*)::integer from public.connections c where c.organization_id = p_org)
    from private.effective_limits(p_org) l;
end $$;
revoke all on function public.get_organization_limits(uuid) from public;
grant execute on function public.get_organization_limits(uuid) to authenticated, service_role;

-- Aplicação atômica: um advisory lock por organização serializa criações concorrentes,
-- de modo que duas inserções simultâneas não ultrapassam o teto. Agentes padrão
-- (um por membro, criados no provisionamento) contam no uso mas nunca bloqueiam a
-- criação de um login.
create or replace function private.enforce_agent_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  if new.is_default then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('sdr.limits:' || new.organization_id::text, 0));
  select max_agents into v_limit from private.effective_limits(new.organization_id);
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.ai_agents
  where organization_id = new.organization_id and status = 'active';
  if v_count >= v_limit then raise exception 'Agent limit reached' using errcode = 'P0001'; end if;
  return new;
end $$;

create or replace function private.enforce_instance_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('sdr.limits:' || new.organization_id::text, 0));
  select max_instances into v_limit from private.effective_limits(new.organization_id);
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.connections where organization_id = new.organization_id;
  if v_count >= v_limit then raise exception 'Instance limit reached' using errcode = 'P0001'; end if;
  return new;
end $$;

-- A RPC de criação de agente passa a depender apenas do trigger (limite por organização).
create or replace function public.create_agent_for_current_user(p_name text,p_description text,p_provider text,p_model text,p_system_prompt text,p_tool_policy jsonb default '{}',p_model_config jsonb default '{}') returns public.ai_agents
language plpgsql security definer set search_path='' as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_agent public.ai_agents;
begin
  select default_organization_id into v_org from public.profiles where user_id = v_uid and status = 'active';
  if v_org is null then raise exception 'Account not found' using errcode = 'P0002'; end if;
  insert into public.ai_agents(organization_id,owner_user_id,name,description,provider,model,system_prompt,tool_policy,model_config)
  values (v_org,v_uid,p_name,p_description,p_provider,p_model,p_system_prompt,p_tool_policy,p_model_config)
  returning * into v_agent;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values (v_org,v_uid,'agent.created',v_agent.id,'{}');
  return v_agent;
end $$;

-- O painel administrativo continua ajustando limites por conta; o ajuste vira uma
-- exceção auditada na organização da conta.
create or replace function public.admin_update_account_limits(p_user uuid,p_max_agents int,p_max_instances int) returns public.account_limits
language plpgsql security definer set search_path='' as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_limits public.account_limits;
begin
  if not exists (select 1 from public.profiles where user_id = v_actor and role = 'admin' and status = 'active') then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if p_max_agents not between 1 and 20 or p_max_instances is not null and p_max_instances < 0 then raise exception 'Invalid limits'; end if;
  select default_organization_id into v_org from public.profiles where user_id = p_user;
  if v_org is null then raise exception 'Resource not found' using errcode = 'P0002'; end if;
  update public.account_limits set max_agents = p_max_agents, max_instances = p_max_instances, updated_at = now()
  where organization_id = v_org and owner_user_id = p_user returning * into v_limits;
  insert into public.organization_limits(organization_id, override_agents, max_agents, override_instances, max_instances, reason, updated_by)
  values (v_org, true, p_max_agents, true, p_max_instances, 'Ajuste manual no painel administrativo', v_actor)
  on conflict (organization_id) do update set
    override_agents = true, max_agents = excluded.max_agents,
    override_instances = true, max_instances = excluded.max_instances,
    reason = excluded.reason, expires_at = null, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_events(organization_id,actor_id,action,entity_id,details)
  values (v_org,v_actor,'account.limits_changed',p_user,jsonb_build_object('max_agents',p_max_agents,'max_instances',p_max_instances));
  return v_limits;
end $$;

create or replace function public.admin_list_accounts() returns table(user_id uuid,display_name text,role public.app_role,status public.account_status,organization_id uuid,max_agents int,max_instances int)
language sql stable security definer set search_path='' as $$
  select p.user_id, p.display_name, p.role, p.status, p.default_organization_id, l.max_agents, l.max_instances
  from public.profiles p
  left join lateral private.effective_limits(p.default_organization_id) l on true
  where exists (select 1 from public.profiles me where me.user_id = auth.uid() and me.role = 'admin' and me.status = 'active')
$$;

-- -----------------------------------------------------------------------------
-- 7. Entitlement: cálculo, sincronização e proteção do tier
-- -----------------------------------------------------------------------------
create function private.guard_organization_tier() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tier is distinct from old.tier
     and coalesce(current_setting('sdr.entitlement_sync', true), '') <> 'on' then
    raise exception 'Organization tier is managed by billing entitlements' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organizations_tier_guard
  before update of tier on public.organizations
  for each row execute function private.guard_organization_tier();

create function private.compute_org_entitlement(p_org uuid, p_now timestamptz default now())
returns table(tier public.org_tier, source text, subscription_id uuid, grant_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_grant public.organization_plan_grants;
  v_sub public.organization_subscriptions;
  v_grace interval := make_interval(days => private.billing_grace_days());
begin
  select * into v_grant from public.organization_plan_grants g
  where g.organization_id = p_org and g.revoked_at is null and (g.expires_at is null or g.expires_at > p_now)
  order by g.created_at desc limit 1;

  -- Assinatura que ainda dá direito: ativa dentro do período (+ carência para a
  -- renovação chegar), inadimplente dentro da carência, ou cancelada até o fim do
  -- período já pago.
  select * into v_sub from public.organization_subscriptions s
  where s.organization_id = p_org and (
       (s.status = 'active' and (s.current_period_end is null or s.current_period_end + v_grace > p_now))
    or (s.status = 'past_due' and coalesce(s.grace_until, s.current_period_end + v_grace) > p_now)
    or (s.status = 'canceled' and s.current_period_end > p_now)
  )
  order by private.tier_rank(s.tier) desc, s.created_at desc limit 1;

  if v_grant.id is not null and (v_sub.id is null or private.tier_rank(v_grant.tier) >= private.tier_rank(v_sub.tier)) then
    tier := v_grant.tier; source := 'grant'; grant_id := v_grant.id; subscription_id := null;
  elsif v_sub.id is not null then
    tier := v_sub.tier; source := 'subscription'; subscription_id := v_sub.id; grant_id := null;
  else
    tier := 'pre-venda'; source := 'default'; subscription_id := null; grant_id := null;
  end if;
  return next;
end $$;
revoke all on function private.compute_org_entitlement(uuid, timestamptz) from public;

create function private.sync_org_entitlement(
  p_org uuid,
  p_reason public.entitlement_change_reason,
  p_actor uuid default null,
  p_payment uuid default null,
  p_event uuid default null,
  p_note text default null,
  p_now timestamptz default now()
) returns public.org_tier
language plpgsql security definer set search_path = '' as $$
declare
  v_current public.org_tier;
  v_next record;
begin
  select tier into v_current from public.organizations where id = p_org for update;
  if v_current is null then raise exception 'Organization not found' using errcode = 'P0002'; end if;
  select * into v_next from private.compute_org_entitlement(p_org, p_now);
  if v_next.tier = v_current then return v_current; end if;

  perform set_config('sdr.entitlement_sync', 'on', true);
  update public.organizations set tier = v_next.tier where id = p_org;
  perform set_config('sdr.entitlement_sync', 'off', true);

  insert into public.billing_entitlement_changes(
    organization_id, previous_tier, new_tier, reason, source,
    subscription_id, payment_id, grant_id, webhook_event_id, actor_user_id, note
  ) values (
    p_org, v_current, v_next.tier, p_reason, v_next.source,
    v_next.subscription_id, p_payment, v_next.grant_id, p_event, p_actor, p_note
  );
  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (p_org, p_actor, 'billing.entitlement_changed', p_org,
    jsonb_build_object('previous_tier', v_current, 'new_tier', v_next.tier, 'reason', p_reason, 'source', v_next.source));
  return v_next.tier;
end $$;
revoke all on function private.sync_org_entitlement(uuid, public.entitlement_change_reason, uuid, uuid, uuid, text, timestamptz) from public;

-- -----------------------------------------------------------------------------
-- 8. Concessão manual (administrador da plataforma), auditada e com expiração opcional
-- -----------------------------------------------------------------------------
create function public.admin_grant_org_plan(p_org uuid, p_tier public.org_tier, p_reason text, p_expires_at timestamptz default null)
returns public.organization_plan_grants
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_grant public.organization_plan_grants;
begin
  if not exists (select 1 from public.profiles where user_id = v_actor and role = 'admin' and status = 'active') then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Reason required' using errcode = '22023'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Expiration must be in the future' using errcode = '22023'; end if;

  update public.organization_plan_grants
  set revoked_at = now(), revoked_by = v_actor, revoke_reason = 'Substituída por nova concessão'
  where organization_id = p_org and revoked_at is null;

  insert into public.organization_plan_grants(organization_id, tier, reason, granted_by, expires_at)
  values (p_org, p_tier, trim(p_reason), v_actor, p_expires_at)
  returning * into v_grant;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (p_org, v_actor, 'billing.plan_granted', v_grant.id,
    jsonb_build_object('tier', p_tier, 'reason', trim(p_reason), 'expires_at', p_expires_at));
  perform private.sync_org_entitlement(p_org, 'manual_grant', v_actor, null, null, trim(p_reason));
  return v_grant;
end $$;
revoke all on function public.admin_grant_org_plan(uuid, public.org_tier, text, timestamptz) from public;
grant execute on function public.admin_grant_org_plan(uuid, public.org_tier, text, timestamptz) to authenticated;

create function public.admin_revoke_org_plan(p_org uuid, p_reason text)
returns public.org_tier
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where user_id = v_actor and role = 'admin' and status = 'active') then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Reason required' using errcode = '22023'; end if;
  update public.organization_plan_grants
  set revoked_at = now(), revoked_by = v_actor, revoke_reason = trim(p_reason)
  where organization_id = p_org and revoked_at is null;
  if not found then raise exception 'Resource not found' using errcode = 'P0002'; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (p_org, v_actor, 'billing.plan_revoked', p_org, jsonb_build_object('reason', trim(p_reason)));
  return private.sync_org_entitlement(p_org, 'manual_revoke', v_actor, null, null, trim(p_reason));
end $$;
revoke all on function public.admin_revoke_org_plan(uuid, text) from public;
grant execute on function public.admin_revoke_org_plan(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Checkout (chamado pela API com a chave de serviço, após autenticar o owner)
-- -----------------------------------------------------------------------------
create function public.billing_open_checkout(
  p_org uuid,
  p_user uuid,
  p_offer_code text,
  p_offer_version integer,
  p_tier public.org_tier,
  p_interval public.billing_interval,
  p_amount_cents integer,
  p_currency text,
  p_provider text,
  p_idempotency_key text,
  p_expires_at timestamptz
) returns public.checkout_intents
language plpgsql security definer set search_path = '' as $$
declare
  v_intent public.checkout_intents;
  v_current public.organization_subscriptions;
  v_tier public.org_tier;
  v_kind text := 'new';
begin
  if not exists (
    select 1 from public.organization_members m join public.profiles p on p.user_id = m.user_id
    where m.organization_id = p_org and m.user_id = p_user and m.role = 'owner' and p.status = 'active'
  ) then
    raise exception 'Only the organization owner can buy a plan' using errcode = '42501';
  end if;

  select * into v_intent from public.checkout_intents
  where organization_id = p_org and requested_by_user_id = p_user and idempotency_key = p_idempotency_key;
  if v_intent.id is not null then
    if v_intent.offer_code <> p_offer_code then
      raise exception 'Idempotency key reused with another offer' using errcode = '22023';
    end if;
    return v_intent;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sdr.billing:' || p_org::text, 0));

  select * into v_current from public.organization_subscriptions
  where organization_id = p_org and status in ('pending_payment', 'active', 'past_due')
  for update;
  select tier into v_tier from public.organizations where id = p_org;

  if v_current.id is not null then
    if private.tier_rank(p_tier) <= private.tier_rank(v_current.tier) then
      raise exception 'Not an upgrade' using errcode = 'P0001', hint = 'not_an_upgrade';
    end if;
    v_kind := 'upgrade';
  elsif private.tier_rank(p_tier) <= private.tier_rank(v_tier) then
    -- Sem assinatura, mas com tier igual ou maior concedido manualmente.
    raise exception 'Plan already active' using errcode = 'P0001', hint = 'already_entitled';
  end if;

  insert into public.checkout_intents(
    organization_id, requested_by_user_id, kind, subscription_id, offer_code, offer_version, tier,
    billing_interval, amount_cents, currency, provider, external_reference, idempotency_key, expires_at
  ) values (
    p_org, p_user, v_kind, v_current.id, p_offer_code, p_offer_version, p_tier,
    p_interval, p_amount_cents, upper(p_currency), p_provider,
    'sdrf_' || replace(gen_random_uuid()::text, '-', ''), p_idempotency_key, p_expires_at
  ) returning * into v_intent;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (p_org, p_user, 'billing.checkout_opened', v_intent.id,
    jsonb_build_object('offer_code', p_offer_code, 'offer_version', p_offer_version, 'kind', v_kind, 'provider', p_provider));
  return v_intent;
end $$;

create function public.billing_attach_checkout(p_intent uuid, p_provider_checkout_id text, p_checkout_url text)
returns public.checkout_intents
language plpgsql security definer set search_path = '' as $$
declare v_intent public.checkout_intents;
begin
  update public.checkout_intents
  set provider_checkout_id = p_provider_checkout_id, checkout_url = p_checkout_url, updated_at = now()
  where id = p_intent and status = 'open'
  returning * into v_intent;
  if v_intent.id is null then raise exception 'Checkout not found' using errcode = 'P0002'; end if;
  return v_intent;
end $$;

create function public.billing_fail_checkout(p_intent uuid, p_failure_code text)
returns void
language sql security definer set search_path = '' as $$
  update public.checkout_intents
  set status = 'failed', failure_code = left(p_failure_code, 80), updated_at = now()
  where id = p_intent and status = 'open'
$$;

create function public.billing_customer_for(p_org uuid, p_provider text)
returns text
language sql stable security definer set search_path = '' as $$
  select provider_customer_id from private.billing_customers where organization_id = p_org and provider = p_provider
$$;

create function public.billing_save_customer(p_org uuid, p_provider text, p_provider_customer_id text)
returns void
language sql security definer set search_path = '' as $$
  insert into private.billing_customers(organization_id, provider, provider_customer_id)
  values (p_org, p_provider, p_provider_customer_id)
  on conflict (organization_id) do update
    set provider = excluded.provider, provider_customer_id = excluded.provider_customer_id, updated_at = now()
$$;

-- Cancelamento voluntário: mantém o acesso até o fim do período pago. Chamado pela API
-- somente depois que o gateway confirmou o cancelamento/reativação.
create function public.billing_set_cancel_at_period_end(p_org uuid, p_user uuid, p_cancel boolean)
returns public.organization_subscriptions
language plpgsql security definer set search_path = '' as $$
declare v_sub public.organization_subscriptions;
begin
  update public.organization_subscriptions
  set cancel_at_period_end = p_cancel, updated_at = now()
  where organization_id = p_org and status in ('active', 'past_due')
  returning * into v_sub;
  if v_sub.id is null then raise exception 'Subscription not found' using errcode = 'P0002'; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (p_org, p_user, case when p_cancel then 'billing.cancel_scheduled' else 'billing.cancel_reverted' end, v_sub.id, '{}');
  return v_sub;
end $$;

-- Downgrade agendado para o próximo ciclo.
create function public.billing_schedule_downgrade(
  p_org uuid, p_user uuid, p_offer_code text, p_offer_version integer, p_tier public.org_tier, p_amount_cents integer
) returns public.organization_subscriptions
language plpgsql security definer set search_path = '' as $$
declare v_sub public.organization_subscriptions;
begin
  select * into v_sub from public.organization_subscriptions
  where organization_id = p_org and status in ('active', 'past_due') for update;
  if v_sub.id is null then raise exception 'Subscription not found' using errcode = 'P0002'; end if;
  if p_tier is not null and private.tier_rank(p_tier) >= private.tier_rank(v_sub.tier) then
    raise exception 'Not a downgrade' using errcode = 'P0001', hint = 'not_a_downgrade';
  end if;
  update public.organization_subscriptions
  set scheduled_offer_code = p_offer_code, scheduled_offer_version = p_offer_version,
      scheduled_tier = p_tier, scheduled_amount_cents = p_amount_cents, updated_at = now()
  where id = v_sub.id returning * into v_sub;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (p_org, p_user, 'billing.downgrade_scheduled', v_sub.id,
    jsonb_build_object('offer_code', p_offer_code, 'tier', p_tier));
  return v_sub;
end $$;

-- -----------------------------------------------------------------------------
-- 10. Inbox de webhooks e processamento idempotente
-- -----------------------------------------------------------------------------
-- O payload é o evento NORMALIZADO pelo adapter do gateway (packages/shared/src/billing.ts,
-- normalizedBillingEventSchema), nunca o corpo bruto: sem cartão, documento ou segredo.
create function public.billing_record_event(p_provider text, p_provider_event_id text, p_event_type text, p_payload jsonb)
returns table(event_id uuid, is_new boolean, processing_status text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
  insert into private.billing_webhook_events(provider, provider_event_id, event_type, payload)
  values (p_provider, p_provider_event_id, p_event_type, p_payload)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;
  if v_id is not null then
    event_id := v_id; is_new := true; processing_status := 'pending'; return next; return;
  end if;
  select e.id, e.processing_status into v_id, v_status from private.billing_webhook_events e
  where e.provider = p_provider and e.provider_event_id = p_provider_event_id;
  event_id := v_id; is_new := false; processing_status := v_status; return next;
end $$;

create function public.billing_claim_events(p_limit integer default 20)
returns table(event_id uuid, provider text, event_type text)
language sql security definer set search_path = '' as $$
  with picked as (
    select e.id from private.billing_webhook_events e
    where e.processing_status in ('pending', 'failed') and e.next_attempt_at <= now()
    order by e.received_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  update private.billing_webhook_events e
  set processing_status = 'processing', attempt_count = e.attempt_count + 1,
      next_attempt_at = now() + interval '2 minutes'
  from picked where e.id = picked.id
  returning e.id, e.provider, e.event_type
$$;

create function public.billing_mark_event_failed(p_event uuid, p_error_code text)
returns void
language sql security definer set search_path = '' as $$
  update private.billing_webhook_events
  set processing_status = case when attempt_count >= 10 then 'dead' else 'failed' end,
      error_code = left(p_error_code, 80),
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempt_count, 7))::integer))
  where id = p_event and processing_status in ('pending', 'processing', 'failed')
$$;

create function public.billing_process_event(p_event uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_event private.billing_webhook_events;
  p jsonb;
  v_kind text;
  v_intent public.checkout_intents;
  v_sub public.organization_subscriptions;
  v_payment public.billing_payments;
  v_prev_payment_status public.billing_payment_status;
  v_org uuid;
  v_amount integer;
  v_currency text;
  v_occurred timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_step interval;
  v_result text := 'processed';
  v_reason public.entitlement_change_reason := 'payment';
  v_new_status public.billing_payment_status;
begin
  select * into v_event from private.billing_webhook_events where id = p_event for update;
  if v_event.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if v_event.processing_status in ('processed', 'ignored', 'needs_review', 'dead') then
    return v_event.processing_status;
  end if;

  p := v_event.payload;
  v_kind := coalesce(p ->> 'kind', '');
  v_amount := nullif(p ->> 'amountCents', '')::integer;
  v_currency := upper(coalesce(nullif(p ->> 'currency', ''), 'BRL'));
  v_occurred := coalesce(nullif(p ->> 'occurredAt', '')::timestamptz, now());
  v_period_start := nullif(p ->> 'periodStart', '')::timestamptz;
  v_period_end := nullif(p ->> 'periodEnd', '')::timestamptz;

  -- Correlação exclusivamente por referências gravadas por nós (nunca por um
  -- organization_id vindo do payload).
  if nullif(p ->> 'externalReference', '') is not null then
    select * into v_intent from public.checkout_intents
    where external_reference = p ->> 'externalReference' and provider = v_event.provider for update;
  end if;
  if nullif(p ->> 'providerSubscriptionId', '') is not null then
    select * into v_sub from public.organization_subscriptions
    where provider = v_event.provider and provider_subscription_id = p ->> 'providerSubscriptionId' for update;
  end if;
  if nullif(p ->> 'providerPaymentId', '') is not null then
    select * into v_payment from public.billing_payments
    where provider = v_event.provider and provider_payment_id = p ->> 'providerPaymentId' for update;
    if v_payment.id is not null then
      v_prev_payment_status := v_payment.status;
      if v_sub.id is null and v_payment.subscription_id is not null then
        select * into v_sub from public.organization_subscriptions where id = v_payment.subscription_id for update;
      end if;
      if v_intent.id is null and v_payment.checkout_intent_id is not null then
        select * into v_intent from public.checkout_intents where id = v_payment.checkout_intent_id for update;
      end if;
    end if;
  end if;
  if v_sub.id is null and v_intent.subscription_id is not null then
    select * into v_sub from public.organization_subscriptions where id = v_intent.subscription_id for update;
  end if;

  v_org := coalesce(v_intent.organization_id, v_sub.organization_id);
  if v_org is null then
    update private.billing_webhook_events
    set processing_status = 'unmatched', error_code = 'unmatched_reference', processed_at = now()
    where id = p_event;
    return 'unmatched';
  end if;
  if v_intent.id is not null and v_sub.id is not null and v_intent.organization_id <> v_sub.organization_id then
    update private.billing_webhook_events
    set processing_status = 'needs_review', error_code = 'organization_mismatch', processed_at = now()
    where id = p_event;
    return 'needs_review';
  end if;
  update private.billing_webhook_events set organization_id = v_org where id = p_event;
  perform pg_advisory_xact_lock(hashtextextended('sdr.billing:' || v_org::text, 0));

  if v_kind in ('payment.created', 'payment.confirmed', 'payment.received', 'payment.overdue',
                'payment.refunded', 'payment.chargeback', 'payment.canceled') then
    if nullif(p ->> 'providerPaymentId', '') is null or v_amount is null then
      update private.billing_webhook_events set processing_status = 'needs_review', error_code = 'missing_payment_data', processed_at = now() where id = p_event;
      return 'needs_review';
    end if;
    v_new_status := case v_kind
      when 'payment.created' then 'pending'
      when 'payment.confirmed' then 'confirmed'
      when 'payment.received' then 'received'
      when 'payment.overdue' then 'overdue'
      when 'payment.refunded' then 'refunded'
      when 'payment.chargeback' then 'chargeback'
      when 'payment.canceled' then 'canceled'
    end::public.billing_payment_status;

    -- Nunca regredir: um pagamento confirmado não volta a pendente/vencido por
    -- evento atrasado; estorno e chargeback sempre prevalecem.
    if v_payment.id is not null and (
         (v_payment.status in ('confirmed', 'received') and v_new_status in ('pending', 'overdue', 'canceled'))
      or (v_payment.status in ('refunded', 'chargeback') and v_new_status not in ('refunded', 'chargeback'))
      or (v_payment.status = 'received' and v_new_status = 'confirmed')
    ) then
      v_new_status := v_payment.status;
    end if;

    if v_payment.id is null then
      insert into public.billing_payments(
        organization_id, subscription_id, checkout_intent_id, provider, provider_payment_id, amount_cents,
        currency, status, billing_type, due_date, paid_at, period_start, period_end, invoice_url
      ) values (
        v_org, v_sub.id, v_intent.id, v_event.provider, p ->> 'providerPaymentId', v_amount,
        v_currency, v_new_status, nullif(p ->> 'billingType', ''), nullif(p ->> 'dueDate', '')::date,
        case when v_new_status in ('confirmed', 'received') then coalesce(nullif(p ->> 'paidAt', '')::timestamptz, v_occurred) end,
        v_period_start, v_period_end, nullif(p ->> 'invoiceUrl', '')
      ) returning * into v_payment;
    else
      update public.billing_payments set
        status = v_new_status,
        subscription_id = coalesce(subscription_id, v_sub.id),
        checkout_intent_id = coalesce(checkout_intent_id, v_intent.id),
        paid_at = case when v_new_status in ('confirmed', 'received') then coalesce(paid_at, nullif(p ->> 'paidAt', '')::timestamptz, v_occurred) else paid_at end,
        refunded_at = case when v_new_status in ('refunded', 'chargeback') then coalesce(refunded_at, v_occurred) else refunded_at end,
        invoice_url = coalesce(nullif(p ->> 'invoiceUrl', ''), invoice_url),
        updated_at = now()
      where id = v_payment.id returning * into v_payment;
    end if;
  end if;

  if v_kind in ('payment.confirmed', 'payment.received') and v_payment.status in ('confirmed', 'received')
     and coalesce(v_prev_payment_status::text, '') not in ('confirmed', 'received') then
    if v_intent.id is not null and v_intent.status <> 'paid' and (v_payment.subscription_id is null or v_payment.subscription_id = v_intent.subscription_id) then
      -- Pagamento inicial de um checkout: valor e moeda precisam bater com o pedido.
      if v_amount <> v_intent.amount_cents or v_currency <> v_intent.currency then
        update private.billing_webhook_events set processing_status = 'needs_review', error_code = 'amount_mismatch', processed_at = now() where id = p_event;
        return 'needs_review';
      end if;
      v_step := case v_intent.billing_interval when 'yearly' then interval '1 year' else interval '1 month' end;
      v_period_start := coalesce(v_period_start, v_occurred);
      v_period_end := coalesce(v_period_end, v_period_start + v_step);

      if v_intent.kind = 'upgrade' then
        select * into v_sub from public.organization_subscriptions where id = v_intent.subscription_id for update;
        if v_sub.id is null or v_sub.status not in ('active', 'past_due') then
          update public.checkout_intents set status = 'paid', paid_at = v_occurred, updated_at = now() where id = v_intent.id;
          update private.billing_webhook_events set processing_status = 'needs_review', error_code = 'upgrade_without_subscription', processed_at = now() where id = p_event;
          return 'needs_review';
        end if;
        update public.organization_subscriptions set
          tier = v_intent.tier, offer_code = v_intent.offer_code, offer_version = v_intent.offer_version,
          billing_interval = v_intent.billing_interval, amount_cents = v_intent.amount_cents, currency = v_intent.currency,
          status = 'active', past_due_since = null, grace_until = null,
          scheduled_offer_code = null, scheduled_offer_version = null, scheduled_tier = null, scheduled_amount_cents = null,
          provider_subscription_id = coalesce(nullif(p ->> 'providerSubscriptionId', ''), provider_subscription_id),
          current_period_start = case when nullif(p ->> 'periodStart', '') is not null then v_period_start else current_period_start end,
          current_period_end = case when nullif(p ->> 'periodEnd', '') is not null then v_period_end else current_period_end end,
          latest_payment_id = v_payment.id, updated_at = now()
        where id = v_sub.id returning * into v_sub;
        v_reason := 'upgrade';
      else
        select * into v_sub from public.organization_subscriptions
        where organization_id = v_org and status in ('pending_payment', 'active', 'past_due') for update;
        if v_sub.id is not null and coalesce(v_sub.provider_subscription_id, '') <> coalesce(p ->> 'providerSubscriptionId', '') then
          -- Dois checkouts pagos para a mesma organização: não cria segunda assinatura.
          update public.checkout_intents set status = 'paid', paid_at = v_occurred, updated_at = now() where id = v_intent.id;
          update private.billing_webhook_events set processing_status = 'needs_review', error_code = 'duplicate_subscription', processed_at = now() where id = p_event;
          return 'needs_review';
        end if;
        if v_sub.id is null then
          insert into public.organization_subscriptions(
            organization_id, provider, provider_subscription_id, provider_customer_id, offer_code, offer_version, tier,
            billing_interval, amount_cents, currency, status, current_period_start, current_period_end, latest_payment_id
          ) values (
            v_org, v_event.provider, nullif(p ->> 'providerSubscriptionId', ''), nullif(p ->> 'providerCustomerId', ''),
            v_intent.offer_code, v_intent.offer_version, v_intent.tier, v_intent.billing_interval, v_intent.amount_cents,
            v_intent.currency, 'active', v_period_start, v_period_end, v_payment.id
          ) returning * into v_sub;
        else
          update public.organization_subscriptions set
            status = 'active', current_period_start = v_period_start, current_period_end = v_period_end,
            latest_payment_id = v_payment.id, updated_at = now()
          where id = v_sub.id returning * into v_sub;
        end if;
      end if;
      update public.checkout_intents set status = 'paid', paid_at = v_occurred, subscription_id = v_sub.id, updated_at = now()
      where id = v_intent.id;
      update public.billing_payments set subscription_id = v_sub.id, period_start = coalesce(period_start, v_period_start), period_end = coalesce(period_end, v_period_end)
      where id = v_payment.id;
      if nullif(p ->> 'providerCustomerId', '') is not null then
        perform public.billing_save_customer(v_org, v_event.provider, p ->> 'providerCustomerId');
      end if;
    elsif v_sub.id is not null then
      -- Renovação de assinatura existente.
      if v_sub.status in ('canceled', 'expired') then
        update private.billing_webhook_events set processing_status = 'needs_review', error_code = 'payment_for_closed_subscription', processed_at = now() where id = p_event;
        return 'needs_review';
      end if;
      if v_sub.scheduled_tier is not null and v_amount = v_sub.scheduled_amount_cents then
        update public.organization_subscriptions set
          tier = scheduled_tier, offer_code = scheduled_offer_code, offer_version = scheduled_offer_version,
          amount_cents = scheduled_amount_cents,
          scheduled_offer_code = null, scheduled_offer_version = null, scheduled_tier = null, scheduled_amount_cents = null
        where id = v_sub.id returning * into v_sub;
        v_reason := 'downgrade';
      elsif v_amount <> v_sub.amount_cents or v_currency <> v_sub.currency then
        update private.billing_webhook_events set processing_status = 'needs_review', error_code = 'amount_mismatch', processed_at = now() where id = p_event;
        return 'needs_review';
      else
        v_reason := 'renewal';
      end if;
      v_step := case v_sub.billing_interval when 'yearly' then interval '1 year' else interval '1 month' end;
      v_period_start := coalesce(v_period_start, greatest(coalesce(v_sub.current_period_end, v_occurred), v_occurred - v_step));
      v_period_end := coalesce(v_period_end, v_period_start + v_step);
      update public.organization_subscriptions set
        status = 'active', past_due_since = null, grace_until = null, suspended_reason = null,
        current_period_start = least(v_period_start, coalesce(current_period_end, v_period_start)),
        current_period_end = greatest(coalesce(current_period_end, v_period_end), v_period_end),
        latest_payment_id = v_payment.id, updated_at = now()
      where id = v_sub.id returning * into v_sub;
      update public.billing_payments set subscription_id = v_sub.id, period_start = coalesce(period_start, v_period_start), period_end = coalesce(period_end, v_period_end)
      where id = v_payment.id;
    else
      -- Pagamento confirmado para um checkout já pago (ex.: segundo pagamento) sem assinatura.
      v_result := 'needs_review';
      update private.billing_webhook_events set processing_status = 'needs_review', error_code = 'payment_without_subscription', processed_at = now() where id = p_event;
      return v_result;
    end if;

  elsif v_kind = 'payment.overdue' and v_payment.status = 'overdue' and v_sub.id is not null
        and v_sub.status in ('active', 'past_due') and v_payment.subscription_id = v_sub.id then
    update public.organization_subscriptions set
      status = 'past_due',
      past_due_since = coalesce(past_due_since, v_occurred),
      grace_until = coalesce(grace_until, greatest(coalesce(current_period_end, v_occurred), v_occurred) + make_interval(days => private.billing_grace_days())),
      updated_at = now()
    where id = v_sub.id;

  elsif v_kind in ('payment.refunded', 'payment.chargeback') and v_sub.id is not null
        and v_payment.subscription_id = v_sub.id and v_sub.status in ('active', 'past_due', 'canceled') then
    -- Política escrita: estorno/chargeback do pagamento vigente retira o direito
    -- imediatamente e deixa a assinatura suspensa para revisão do suporte.
    if v_sub.latest_payment_id = v_payment.id then
      update public.organization_subscriptions set
        status = 'suspended', suspended_reason = v_kind, updated_at = now()
      where id = v_sub.id;
      v_reason := case v_kind when 'payment.refunded' then 'refund' else 'chargeback' end;
    end if;

  elsif v_kind = 'subscription.canceled' and v_sub.id is not null then
    update public.organization_subscriptions set
      status = case when status in ('active', 'past_due', 'pending_payment') then 'canceled'::public.subscription_status else status end,
      cancel_at_period_end = true, canceled_at = coalesce(canceled_at, v_occurred), updated_at = now()
    where id = v_sub.id;
    v_reason := 'period_ended';

  elsif v_kind in ('checkout.expired', 'checkout.canceled') and v_intent.id is not null then
    update public.checkout_intents
    set status = case v_kind when 'checkout.expired' then 'expired'::public.checkout_intent_status else 'canceled'::public.checkout_intent_status end,
        updated_at = now()
    where id = v_intent.id and status = 'open';

  elsif v_kind not in ('payment.created', 'payment.confirmed', 'payment.received', 'payment.overdue',
                       'payment.refunded', 'payment.chargeback', 'payment.canceled') then
    v_result := 'ignored';
  end if;

  perform private.sync_org_entitlement(v_org, v_reason, null, v_payment.id, p_event);
  update private.billing_webhook_events set processing_status = v_result, error_code = null, processed_at = now() where id = p_event;
  return v_result;
end $$;

-- Rotina periódica (worker): expira checkouts, aplica fim de carência/período,
-- downgrades agendados e concessões vencidas. Idempotente.
create function public.billing_run_maintenance(p_now timestamptz default now())
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_changed integer := 0;
  v_org record;
  v_grace interval := make_interval(days => private.billing_grace_days());
  v_before public.org_tier;
  v_after public.org_tier;
begin
  update public.checkout_intents set status = 'expired', updated_at = now()
  where status = 'open' and expires_at <= p_now;

  -- Downgrade agendado entra em vigor no fim do ciclo corrente.
  update public.organization_subscriptions set
    tier = scheduled_tier, offer_code = scheduled_offer_code, offer_version = scheduled_offer_version,
    amount_cents = scheduled_amount_cents,
    scheduled_offer_code = null, scheduled_offer_version = null, scheduled_tier = null, scheduled_amount_cents = null,
    updated_at = now()
  where scheduled_tier is not null and status in ('active', 'past_due') and current_period_end <= p_now;

  update public.organization_subscriptions set status = 'suspended', suspended_reason = 'grace_expired', updated_at = now()
  where status = 'past_due' and coalesce(grace_until, current_period_end + v_grace) <= p_now;
  update public.organization_subscriptions set status = 'suspended', suspended_reason = 'renewal_missing', updated_at = now()
  where status = 'active' and current_period_end + v_grace <= p_now;
  update public.organization_subscriptions set status = 'expired', updated_at = now()
  where status = 'canceled' and current_period_end <= p_now;

  update public.organization_plan_grants set revoked_at = expires_at, revoke_reason = 'Concessão expirada'
  where revoked_at is null and expires_at is not null and expires_at <= p_now;

  for v_org in
    select o.id, o.tier from public.organizations o
    where exists (select 1 from public.organization_subscriptions s where s.organization_id = o.id)
       or exists (select 1 from public.organization_plan_grants g where g.organization_id = o.id)
       or o.tier <> 'pre-venda'
  loop
    v_before := v_org.tier;
    v_after := private.sync_org_entitlement(
      v_org.id,
      case
        when exists (select 1 from public.organization_subscriptions s where s.organization_id = v_org.id and s.suspended_reason = 'grace_expired' and s.updated_at >= now() - interval '1 minute') then 'grace_expired'::public.entitlement_change_reason
        when exists (select 1 from public.organization_plan_grants g where g.organization_id = v_org.id and g.revoke_reason = 'Concessão expirada' and g.revoked_at <= p_now) then 'grant_expired'::public.entitlement_change_reason
        else 'period_ended'::public.entitlement_change_reason
      end,
      null, null, null, null, p_now
    );
    if v_after is distinct from v_before then v_changed := v_changed + 1; end if;
  end loop;
  return v_changed;
end $$;

-- Conciliação: divergências para o painel operacional/alertas.
create function public.billing_reconciliation_report()
returns table(kind text, organization_id uuid, reference text)
language sql stable security definer set search_path = '' as $$
  select 'webhook_stuck', e.organization_id, e.id::text from private.billing_webhook_events e
    where e.processing_status in ('pending', 'processing', 'failed') and e.received_at < now() - interval '15 minutes'
  union all
  select 'webhook_' || e.processing_status, e.organization_id, e.id::text from private.billing_webhook_events e
    where e.processing_status in ('unmatched', 'needs_review', 'dead')
  union all
  select 'tier_without_entitlement', o.id, o.tier::text from public.organizations o
    where o.tier <> (select c.tier from private.compute_org_entitlement(o.id) c)
  union all
  select 'active_subscription_without_payment', s.organization_id, s.id::text from public.organization_subscriptions s
    where s.status = 'active' and not exists (
      select 1 from public.billing_payments bp where bp.subscription_id = s.id and bp.status in ('confirmed', 'received'))
$$;

-- Funções de billing: execução apenas pelo backend (chave de serviço).
revoke all on function public.billing_open_checkout(uuid, uuid, text, integer, public.org_tier, public.billing_interval, integer, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_attach_checkout(uuid, text, text) from public, anon, authenticated;
revoke all on function public.billing_fail_checkout(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_customer_for(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_save_customer(uuid, text, text) from public, anon, authenticated;
revoke all on function public.billing_set_cancel_at_period_end(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.billing_schedule_downgrade(uuid, uuid, text, integer, public.org_tier, integer) from public, anon, authenticated;
revoke all on function public.billing_record_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.billing_claim_events(integer) from public, anon, authenticated;
revoke all on function public.billing_mark_event_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_process_event(uuid) from public, anon, authenticated;
revoke all on function public.billing_run_maintenance(timestamptz) from public, anon, authenticated;
revoke all on function public.billing_reconciliation_report() from public, anon, authenticated;
grant execute on function public.billing_open_checkout(uuid, uuid, text, integer, public.org_tier, public.billing_interval, integer, text, text, text, timestamptz) to service_role;
grant execute on function public.billing_attach_checkout(uuid, text, text) to service_role;
grant execute on function public.billing_fail_checkout(uuid, text) to service_role;
grant execute on function public.billing_customer_for(uuid, text) to service_role;
grant execute on function public.billing_save_customer(uuid, text, text) to service_role;
grant execute on function public.billing_set_cancel_at_period_end(uuid, uuid, boolean) to service_role;
grant execute on function public.billing_schedule_downgrade(uuid, uuid, text, integer, public.org_tier, integer) to service_role;
grant execute on function public.billing_record_event(text, text, text, jsonb) to service_role;
grant execute on function public.billing_claim_events(integer) to service_role;
grant execute on function public.billing_mark_event_failed(uuid, text) to service_role;
grant execute on function public.billing_process_event(uuid) to service_role;
grant execute on function public.billing_run_maintenance(timestamptz) to service_role;
grant execute on function public.billing_reconciliation_report() to service_role;

-- -----------------------------------------------------------------------------
-- 11. Migração de dados existentes
-- -----------------------------------------------------------------------------
-- (a) Tiers atribuídos manualmente antes da cobrança viram concessões auditadas,
--     para que a sincronização não rebaixe clientes atuais.
insert into public.organization_plan_grants(organization_id, tier, reason)
select id, tier, 'Plano atribuído manualmente antes da cobrança (migração)'
from public.organizations
where tier <> 'pre-venda';

-- (b) Limites legados (por conta) mais generosos que o plano viram exceção por
--     organização. max_instances nulo era "ilimitado" e continua assim para quem já existe.
insert into public.organization_limits(organization_id, override_agents, max_agents, override_instances, max_instances, reason)
select
  legacy.organization_id,
  legacy.max_agents > coalesce(plan.max_agents, 2147483647),
  case when legacy.max_agents > coalesce(plan.max_agents, 2147483647) then legacy.max_agents end,
  plan.max_instances is not null and (legacy.unlimited_instances or legacy.max_instances > plan.max_instances),
  case when legacy.unlimited_instances then null else legacy.max_instances end,
  'Limites anteriores à cobrança preservados (migração)'
from (
  select l.organization_id,
    max(l.max_agents) as max_agents,
    bool_or(l.max_instances is null) as unlimited_instances,
    max(l.max_instances) as max_instances
  from public.account_limits l
  group by l.organization_id
) legacy
join public.organizations o on o.id = legacy.organization_id
cross join lateral private.plan_limits(o.tier) plan
where legacy.max_agents > coalesce(plan.max_agents, 2147483647)
   or (plan.max_instances is not null and (legacy.unlimited_instances or legacy.max_instances > plan.max_instances));

commit;

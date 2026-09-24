begin;

-- =============================================================================
-- Vínculo da assinatura do gateway e upgrade por troca de assinatura
-- =============================================================================
--
-- Alguns gateways (AbacatePay) não informam o ID da assinatura no evento de pagamento
-- do checkout: ele chega em outro evento (subscription.*), em qualquer ordem. E o
-- upgrade não altera a assinatura existente de imediato: cria-se uma assinatura nova
-- e a antiga precisa ser cancelada no gateway.
--
-- 1. checkout_intents.provider_subscription_id guarda o ID assim que qualquer evento o
--    revelar (correlação por external_reference ou pelo cliente do gateway).
-- 2. private.billing_link_subscriptions copia esse ID para organization_subscriptions,
--    seja qual for a ordem dos eventos, e troca o ID num upgrade pago.
-- 3. A assinatura substituída vai para private.billing_replaced_subscriptions: seus
--    eventos passam a ser ignorados (nunca cancelam/rebaixam o plano novo) e o worker a
--    cancela no gateway.

alter table public.checkout_intents add column provider_subscription_id text;
create index checkout_intents_provider_subscription_idx
  on public.checkout_intents(provider, provider_subscription_id)
  where provider_subscription_id is not null;

create table private.billing_replaced_subscriptions (
  provider text not null,
  provider_subscription_id text not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  replaced_by text not null,
  replaced_at timestamptz not null default now(),
  canceled_at timestamptz,
  cancel_attempts integer not null default 0,
  last_error text,
  primary key (provider, provider_subscription_id)
);
alter table private.billing_replaced_subscriptions enable row level security;
alter table private.billing_replaced_subscriptions force row level security;
revoke all on private.billing_replaced_subscriptions from public;
grant all on private.billing_replaced_subscriptions to service_role;

create function private.billing_link_subscriptions(p_provider text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Assinatura nova: preenche o ID ausente.
  update public.organization_subscriptions s
  set provider_subscription_id = i.provider_subscription_id, updated_at = now()
  from public.checkout_intents i
  where i.subscription_id = s.id and i.organization_id = s.organization_id
    and i.kind = 'new' and i.status = 'paid' and i.provider = p_provider
    and s.provider = p_provider and s.provider_subscription_id is null
    and i.provider_subscription_id is not null
    and not exists (
      select 1 from public.organization_subscriptions o
      where o.provider = p_provider and o.provider_subscription_id = i.provider_subscription_id
    );

  -- Upgrade pago: a assinatura passa a apontar para a nova e a antiga é substituída.
  for r in
    select distinct on (s.id) s.id, s.organization_id, s.provider_subscription_id as old_id, i.provider_subscription_id as new_id
    from public.organization_subscriptions s
    join public.checkout_intents i on i.subscription_id = s.id and i.organization_id = s.organization_id
    where i.kind = 'upgrade' and i.status = 'paid' and i.provider = p_provider and s.provider = p_provider
      and i.provider_subscription_id is not null
      and s.tier = i.tier
      and s.provider_subscription_id is distinct from i.provider_subscription_id
      and not exists (
        select 1 from private.billing_replaced_subscriptions x
        where x.provider = p_provider and x.provider_subscription_id = i.provider_subscription_id
      )
      and not exists (
        select 1 from public.organization_subscriptions o
        where o.provider = p_provider and o.provider_subscription_id = i.provider_subscription_id and o.id <> s.id
      )
    order by s.id, i.paid_at desc nulls last
  loop
    if r.old_id is not null then
      insert into private.billing_replaced_subscriptions(provider, provider_subscription_id, organization_id, replaced_by)
      values (p_provider, r.old_id, r.organization_id, r.new_id)
      on conflict do nothing;
    end if;
    update public.organization_subscriptions
    set provider_subscription_id = r.new_id, updated_at = now()
    where id = r.id;
    insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
    values (r.organization_id, null, 'billing.subscription_replaced', r.id,
      jsonb_build_object('provider', p_provider, 'previous', r.old_id, 'current', r.new_id));
  end loop;
end $$;
revoke all on function private.billing_link_subscriptions(text) from public;

-- O processamento transacional existente vira o núcleo; a função pública passa a
-- tratar vínculo e assinaturas substituídas antes e depois dele.
alter function public.billing_process_event(uuid) rename to billing_process_event_core;
alter function public.billing_process_event_core(uuid) set schema private;
revoke all on function private.billing_process_event_core(uuid) from public, anon, authenticated;

create function public.billing_process_event(p_event uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_event private.billing_webhook_events;
  v_sub_ref text;
  v_ref text;
  v_customer text;
  v_result text;
begin
  select * into v_event from private.billing_webhook_events where id = p_event for update;
  if v_event.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if v_event.processing_status in ('processed', 'ignored', 'needs_review', 'dead') then
    return v_event.processing_status;
  end if;

  v_sub_ref := nullif(v_event.payload ->> 'providerSubscriptionId', '');
  v_ref := nullif(v_event.payload ->> 'externalReference', '');
  v_customer := nullif(v_event.payload ->> 'providerCustomerId', '');

  if v_sub_ref is not null and exists (
    select 1 from private.billing_replaced_subscriptions x
    where x.provider = v_event.provider and x.provider_subscription_id = v_sub_ref
  ) then
    update private.billing_webhook_events
    set processing_status = 'ignored', error_code = 'replaced_subscription', processed_at = now(),
        organization_id = (select x.organization_id from private.billing_replaced_subscriptions x
                           where x.provider = v_event.provider and x.provider_subscription_id = v_sub_ref)
    where id = p_event;
    return 'ignored';
  end if;

  if v_sub_ref is not null and not exists (
    select 1 from public.organization_subscriptions s
    where s.provider = v_event.provider and s.provider_subscription_id = v_sub_ref
  ) then
    if v_ref is not null then
      update public.checkout_intents
      set provider_subscription_id = v_sub_ref, updated_at = now()
      where external_reference = v_ref and provider = v_event.provider and provider_subscription_id is null;
    elsif v_customer is not null then
      -- Sem referência nossa no evento: usa o cliente do gateway, gravado por organização.
      update public.checkout_intents
      set provider_subscription_id = v_sub_ref, updated_at = now()
      where id = (
        select i.id from public.checkout_intents i
        join private.billing_customers c on c.organization_id = i.organization_id and c.provider = i.provider
        where c.provider = v_event.provider and c.provider_customer_id = v_customer
          and i.provider_subscription_id is null and i.status in ('open', 'paid')
        order by i.created_at desc
        limit 1
      );
    end if;
    perform private.billing_link_subscriptions(v_event.provider);
  end if;

  v_result := private.billing_process_event_core(p_event);
  perform private.billing_link_subscriptions(v_event.provider);
  return v_result;
end $$;
revoke all on function public.billing_process_event(uuid) from public, anon, authenticated;
grant execute on function public.billing_process_event(uuid) to service_role;

-- Fila de cancelamentos no gateway para assinaturas substituídas (worker).
create function public.billing_pending_replaced_subscriptions(p_limit integer default 20)
returns table(provider text, provider_subscription_id text, organization_id uuid)
language sql stable security definer set search_path = '' as $$
  select x.provider, x.provider_subscription_id, x.organization_id
  from private.billing_replaced_subscriptions x
  where x.canceled_at is null and x.cancel_attempts < 10
  order by x.replaced_at
  limit greatest(1, least(p_limit, 100))
$$;

create function public.billing_mark_replaced_subscription(p_provider text, p_provider_subscription_id text, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update private.billing_replaced_subscriptions
  set canceled_at = case when p_error is null then now() else canceled_at end,
      cancel_attempts = cancel_attempts + 1,
      last_error = left(p_error, 200)
  where provider = p_provider and provider_subscription_id = p_provider_subscription_id
$$;

revoke all on function public.billing_pending_replaced_subscriptions(integer) from public, anon, authenticated;
revoke all on function public.billing_mark_replaced_subscription(text, text, text) from public, anon, authenticated;
grant execute on function public.billing_pending_replaced_subscriptions(integer) to service_role;
grant execute on function public.billing_mark_replaced_subscription(text, text, text) to service_role;

-- Conciliação: assinatura ativa sem ID do gateway e substituídas que não cancelaram.
create or replace function public.billing_reconciliation_report()
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
  union all
  select 'subscription_without_provider_id', s.organization_id, s.id::text from public.organization_subscriptions s
    where s.status in ('active', 'past_due') and s.provider_subscription_id is null and s.created_at < now() - interval '1 hour'
  union all
  select 'replaced_subscription_not_canceled', x.organization_id, x.provider_subscription_id from private.billing_replaced_subscriptions x
    where x.canceled_at is null and (x.cancel_attempts >= 3 or x.replaced_at < now() - interval '1 hour')
$$;

commit;

begin;

-- Phase 1 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 7): durable webhook acceptance and
-- idempotency. Replaces the in-memory IdempotencyGate (a process-local Set, lost on restart and
-- not shared across replicas) with a Postgres-backed accept step that runs before any Redis
-- interaction, plus atomic upserts that close the select-then-insert races in
-- ConversationRepository.findOrCreateLead and the unguarded insert in saveMessage.

create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  provider public.connection_provider not null,
  provider_message_id text,
  conversation_key text not null,
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  status text not null default 'received' check (status in ('received','processing','processed','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- provider_message_id is nullable: a provider event missing an id (parser fallback to '')
  -- must never be normalized to '' and treated as one giant duplicate bucket. NULL never
  -- conflicts under the unique constraint, matching how public.messages already handles this.
  unique (organization_id, connection_id, provider, provider_message_id),
  foreign key (organization_id, connection_id) references public.connections(organization_id, id)
);
-- Dispatcher scan: sweep events stuck in received/failed to re-enqueue (8.3.6).
create index inbound_events_dispatch_idx on public.inbound_events(status, available_at, created_at)
  where status in ('received', 'failed');
create index inbound_events_org_conn_time_idx on public.inbound_events(organization_id, connection_id, created_at desc);

alter table public.inbound_events enable row level security;
-- No select/insert/update policy is created for anon/authenticated: RLS enabled with zero
-- policies denies all access to those roles even under a future accidental grant. Only
-- service_role (bypassrls) and the security-definer RPCs below can touch this table, and
-- normalized_payload never appears in a user-facing endpoint.
revoke all on public.inbound_events from anon, authenticated;
grant all on public.inbound_events to service_role;

create function private.touch_inbound_events_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger inbound_events_touch_updated_at before update on public.inbound_events
  for each row execute function private.touch_inbound_events_updated_at();

-- Accepts one provider event durably, as the very first DB call in the webhook handler right
-- after signature verification — organization_id is resolved from the connection here so the
-- caller (which only has connection_id from the route) never needs a separate lookup first.
-- Always insert-or-fetch, never overwrite an existing event's payload (7.3.4), safe under
-- concurrent callers for the same (connection_id, provider, provider_message_id) tuple (7.3.5).
-- Runs no LLM, WhatsApp or calendar side effect (7.3.6) — it only persists.
create function public.accept_inbound_event(
  p_connection_id uuid,
  p_provider public.connection_provider,
  p_provider_message_id text,
  p_conversation_key text,
  p_normalized_payload jsonb
) returns table(event_id uuid, organization_id uuid, is_new boolean, status text)
language plpgsql security definer set search_path = '' as $$
-- RETURNS TABLE auto-declares event_id/organization_id/is_new/status as PL/pgSQL variables,
-- which otherwise collide with identically-named columns anywhere below (including inside an
-- ON CONFLICT target list, which PL/pgSQL also resolves through its variable namespace). Every
-- local variable here is v_-prefixed, so preferring the column reading is always correct.
#variable_conflict use_column
declare
  v_org uuid;
  v_id uuid;
  v_status text;
begin
  select c.organization_id into v_org from public.connections c where c.id = p_connection_id;
  if v_org is null then
    raise exception 'Connection not found' using errcode = 'P0002';
  end if;

  insert into public.inbound_events(
    organization_id, connection_id, provider, provider_message_id, conversation_key, normalized_payload
  ) values (
    v_org, p_connection_id, p_provider, nullif(p_provider_message_id, ''), p_conversation_key, p_normalized_payload
  )
  on conflict (organization_id, connection_id, provider, provider_message_id) do nothing
  returning inbound_events.id, inbound_events.status into v_id, v_status;

  if v_id is not null then
    return query select v_id, v_org, true, v_status;
    return;
  end if;

  select ie.id, ie.status into v_id, v_status
    from public.inbound_events ie
    where ie.organization_id = v_org and ie.connection_id = p_connection_id
      and ie.provider = p_provider and ie.provider_message_id = nullif(p_provider_message_id, '');

  return query select v_id, v_org, false, v_status;
end $$;
revoke all on function public.accept_inbound_event(uuid,public.connection_provider,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.accept_inbound_event(uuid,public.connection_provider,text,text,jsonb) to service_role;

create function public.mark_inbound_event_status(
  p_organization_id uuid, p_event_id uuid, p_status text, p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_status not in ('received','processing','processed','failed') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.inbound_events
    set status = p_status,
        attempt_count = case when p_status = 'processing' then attempt_count + 1 else attempt_count end,
        processing_started_at = case when p_status = 'processing' then now() else processing_started_at end,
        processed_at = case when p_status in ('processed','failed') then now() else processed_at end,
        last_error = case when p_status = 'failed' then left(p_error, 2000) else last_error end
    where inbound_events.id = p_event_id and inbound_events.organization_id = p_organization_id;
end $$;
revoke all on function public.mark_inbound_event_status(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.mark_inbound_event_status(uuid,uuid,text,text) to service_role;

-- Idempotent message insert + atomic, monotonic last_message_at bump (7.4.7). A retried
-- delivery for the same provider_message_id never throws, never creates a second row, and
-- never moves last_message_at backwards.
create function public.save_inbound_message(
  p_organization_id uuid,
  p_connection_id uuid,
  p_conversation_id uuid,
  p_direction text,
  p_sender text,
  p_content text,
  p_message_type text,
  p_provider_message_id text
) returns table(id uuid, created_at timestamptz, is_new boolean)
language plpgsql security definer set search_path = '' as $$
-- See the matching comment on accept_inbound_event above: RETURNS TABLE auto-declares
-- id/created_at/is_new as PL/pgSQL variables that collide with real column names.
#variable_conflict use_column
declare
  v_id uuid;
  v_created_at timestamptz;
begin
  insert into public.messages(
    organization_id, connection_id, conversation_id, direction, sender, content, message_type, provider_message_id
  ) values (
    p_organization_id, p_connection_id, p_conversation_id, p_direction, p_sender, p_content, coalesce(p_message_type, 'text'), nullif(p_provider_message_id, '')
  )
  on conflict (organization_id, connection_id, provider_message_id) do nothing
  returning messages.id, messages.created_at into v_id, v_created_at;

  if v_id is not null then
    update public.conversations c
      set last_message_at = greatest(coalesce(c.last_message_at, v_created_at), v_created_at),
          updated_at = greatest(c.updated_at, v_created_at)
      where c.id = p_conversation_id and c.organization_id = p_organization_id;
    return query select v_id, v_created_at, true;
    return;
  end if;

  select m.id, m.created_at into v_id, v_created_at
    from public.messages m
    where m.organization_id = p_organization_id and m.connection_id = p_connection_id
      and m.provider_message_id = nullif(p_provider_message_id, '')
    limit 1;

  return query select v_id, v_created_at, false;
end $$;
revoke all on function public.save_inbound_message(uuid,uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.save_inbound_message(uuid,uuid,uuid,text,text,text,text,text) to service_role;

-- Atomic upsert closing the select-then-insert race in findOrCreateLead (7.4.8). Targets the
-- scoped partial unique index leads_instance_phone_key(organization_id, connection_id, phone)
-- added by 202609120008_account_operations.sql, which replaced the earlier org+phone-only
-- constraint. Preserves current semantics: only fill in name when the existing lead has none.
create function public.find_or_create_lead(
  p_organization_id uuid, p_connection_id uuid, p_phone text, p_name text
) returns public.leads
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_owner uuid;
  v_lead public.leads;
begin
  select c.owner_user_id into v_owner from public.connections c
    where c.id = p_connection_id and c.organization_id = p_organization_id;
  if v_owner is null then
    raise exception 'Connection not found or missing owner' using errcode = 'P0002';
  end if;

  insert into public.leads(organization_id, owner_user_id, connection_id, phone, name, memory)
  values (p_organization_id, v_owner, p_connection_id, p_phone, nullif(trim(coalesce(p_name, '')), ''), '{}')
  on conflict (organization_id, connection_id, phone) where connection_id is not null
  do update set name = coalesce(public.leads.name, excluded.name), updated_at = now()
  returning * into v_lead;

  return v_lead;
end $$;
revoke all on function public.find_or_create_lead(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.find_or_create_lead(uuid,uuid,text,text) to service_role;

-- Turn-level idempotency (7.5): lets a retried worker job recover the flow_execution already
-- created for the same logical turn instead of creating a duplicate execution row. The
-- application computes the key from schemaVersion + org + connection + sorted inbound_events
-- ids + flow_version_id; ExecutionRepository.createExecution catches the unique violation and
-- returns the existing row.
alter table public.flow_executions add column if not exists idempotency_key text;
create unique index if not exists flow_executions_idempotency_key_idx
  on public.flow_executions(organization_id, idempotency_key) where idempotency_key is not null;

commit;

begin;

-- account_limits.max_agents was only enforced inside create_agent_for_current_user(), but
-- since 9e37163 ("isolate connections by dedicated agent") every new connection also inserts
-- its own dedicated ai_agents row directly (packages/db/src/connection-repository.ts), never
-- going through that RPC. A client could accumulate one agent per WhatsApp instance with no
-- cap at all. Enforce the limit as a trigger instead, so every insert path is covered
-- uniformly — the RPC's own check stays in place too (cheaper failure, same error code).
create function private.enforce_agent_limit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  select max_agents into v_limit from public.account_limits where organization_id = new.organization_id and owner_user_id = new.owner_user_id;
  if v_limit is null then v_limit := 2; end if;
  select count(*) into v_count from public.ai_agents where organization_id = new.organization_id and owner_user_id = new.owner_user_id and status = 'active';
  if v_count >= v_limit then raise exception 'Agent limit reached' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger agent_limit_check before insert on public.ai_agents for each row when (new.status = 'active') execute function private.enforce_agent_limit();

-- account_limits.max_instances existed since 202609120007 (admin panel already edits it) but
-- was never actually checked anywhere. Named to sort after fill_connection_scope
-- (private.fill_connection_owner_agent, 202609120007) so NEW.owner_user_id is already
-- populated by the time this runs — Postgres fires same-event BEFORE triggers in
-- alphabetical order by trigger name, not creation order.
create function private.enforce_instance_limit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  select max_instances into v_limit from public.account_limits where organization_id = new.organization_id and owner_user_id = new.owner_user_id;
  if v_limit is null then return new; end if; -- null = unlimited, per account_limits' own check constraint
  select count(*) into v_count from public.connections where organization_id = new.organization_id and owner_user_id = new.owner_user_id;
  if v_count >= v_limit then raise exception 'Instance limit reached' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger instance_limit_check before insert on public.connections for each row execute function private.enforce_instance_limit();

-- Nothing stopped two connections (possibly in different organizations) from pointing at the
-- same Evolution instance. Whichever one last called setWebhook silently won the instance's
-- webhook target, so the other connection's inbound messages routed to the wrong org/agent.
-- provider_instance_id is opaque per provider (Evolution instance name / Meta phone number
-- id), so scoping the constraint by provider is enough without needing the server URL, which
-- lives only encrypted in connection_credentials.
create unique index connections_provider_instance_unique
  on public.connections(provider, provider_instance_id)
  where provider_instance_id is not null;

commit;

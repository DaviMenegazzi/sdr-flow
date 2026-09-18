begin;

-- 1. Org Tiers enum and column
create type public.org_tier as enum ('pre-venda', 'vendedor', 'vendedor-senior');

alter table public.organizations
  add column if not exists tier public.org_tier not null default 'pre-venda';

-- 2. Drop restrictive connection policies that prevented multi-user access within the same organization
drop policy if exists connection_owner_select on public.connections;
drop policy if exists connection_owner_write on public.connections;

-- Ensure connections are visible to all members of the organization
-- (The permissive policy org_read from 202609080001 already covers private.org_role(organization_id) is not null).

-- 3. Replace owner-only ai_agents policies to allow organization members to view agents
drop policy if exists agents_read_self on public.ai_agents;
drop policy if exists agents_update_self on public.ai_agents;

create policy agents_org_select on public.ai_agents for select to authenticated
  using (private.org_role(organization_id) is not null and private.current_profile_is_active());

create policy agents_org_update on public.ai_agents for update to authenticated
  using (
    (private.org_role(organization_id) in ('owner', 'admin') or owner_user_id = (select auth.uid()))
    and private.current_profile_is_active()
  )
  with check (
    (private.org_role(organization_id) in ('owner', 'admin') or owner_user_id = (select auth.uid()))
    and private.current_profile_is_active()
  );

-- 4. Replace owner-only account_limits policy to allow organization members to view limits
drop policy if exists limits_read_self on public.account_limits;

create policy limits_org_select on public.account_limits for select to authenticated
  using (private.org_role(organization_id) is not null and private.current_profile_is_active());

-- 5. Update assign_agent_to_connection to allow owner/admin of the organization
create or replace function public.assign_agent_to_connection(p_connection uuid, p_agent uuid)
returns public.connections language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_conn public.connections;
  v_org uuid;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select organization_id into v_org from public.connections where id = p_connection;
  if v_org is null then raise exception 'Connection not found' using errcode='P0002'; end if;
  if private.org_role(v_org) not in ('owner', 'admin') then
    raise exception 'Permission denied' using errcode='42501';
  end if;
  if not exists (select 1 from public.ai_agents where id = p_agent and organization_id = v_org and status = 'active') then
    raise exception 'Agent not found in organization' using errcode='P0002';
  end if;
  update public.connections c set agent_id = p_agent, updated_at = now()
  where c.id = p_connection and c.organization_id = v_org
  returning * into v_conn;
  return v_conn;
end $$;

commit;

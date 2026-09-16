begin;

-- Every agent must authenticate to OpenAI with its own key: never a platform-wide shared
-- key, and never readable by any other agent/owner. Mirrors private.connection_credentials
-- exactly (ciphertext-only storage, service_role-only RPCs, decryption happens in the API
-- process, never in Postgres).
create table private.agent_credentials (
  agent_id uuid primary key references public.ai_agents(id) on delete cascade,
  organization_id uuid not null,
  owner_user_id uuid not null,
  ciphertext text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, owner_user_id, agent_id) references public.ai_agents(organization_id, owner_user_id, id) on delete cascade
);
alter table private.agent_credentials enable row level security;

-- PostgREST exposes public RPCs, never the private credentials table (same contract as
-- set/get_connection_credentials in 202609080006_provider_credentials.sql).
create function public.set_agent_openai_key(p_org uuid, p_owner uuid, p_agent uuid, p_ciphertext text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ai_agents where id = p_agent and organization_id = p_org and owner_user_id = p_owner) then
    raise exception 'Agent not found in organization';
  end if;
  insert into private.agent_credentials(agent_id, organization_id, owner_user_id, ciphertext, key_version)
  values (p_agent, p_org, p_owner, p_ciphertext, 1)
  on conflict (agent_id) do update set ciphertext = excluded.ciphertext, updated_at = now();
end;
$$;

create function public.get_agent_openai_key(p_agent uuid)
returns text language sql stable security definer set search_path = '' as $$
  select ciphertext from private.agent_credentials where agent_id = p_agent;
$$;

-- Existence-only check: safe to expose more broadly than the ciphertext itself, so the
-- agents list/detail views can show a "key configured" badge without decrypting anything.
create function public.agent_has_openai_key(p_agent uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.agent_credentials where agent_id = p_agent);
$$;

revoke all on function public.set_agent_openai_key(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_agent_openai_key(uuid) from public, anon, authenticated;
revoke all on function public.agent_has_openai_key(uuid) from public, anon, authenticated;
grant execute on function public.set_agent_openai_key(uuid, uuid, uuid, text) to service_role;
grant execute on function public.get_agent_openai_key(uuid) to service_role;
grant execute on function public.agent_has_openai_key(uuid) to service_role;

commit;

begin;

-- Agents now get their OpenAI key provisioned automatically: the API uses the platform's
-- OpenAI Admin key to create one OpenAI project per agent plus a service account inside it,
-- and stores the service account's key here. Keys pasted by a platform admin ("own") keep
-- working and are never overwritten by provisioning.
alter table private.agent_credentials
  add column source text not null default 'own' check (source in ('platform', 'own')),
  add column openai_project_id text,
  add column openai_service_account_id text;

-- Sync status is not secret (the org sees "sincronizado"/"falhou"), so it lives on the agent.
-- Only the service role writes it: authenticated only has SELECT on ai_agents.
alter table public.ai_agents
  add column openai_sync_status text not null default 'pending' check (openai_sync_status in ('pending', 'synced', 'failed')),
  add column openai_sync_error text,
  -- How many conversations this agent may be answering at the same time (worker semaphore).
  add column max_concurrent_replies integer not null default 3 check (max_concurrent_replies between 1 and 50);

update public.ai_agents a set openai_sync_status = 'synced'
where exists (select 1 from private.agent_credentials c where c.agent_id = a.id);

drop function public.set_agent_openai_key(uuid, uuid, uuid, text);

create function public.set_agent_openai_key(
  p_org uuid, p_owner uuid, p_agent uuid, p_ciphertext text,
  p_source text default 'own', p_project text default null, p_service_account text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ai_agents where id = p_agent and organization_id = p_org and owner_user_id = p_owner) then
    raise exception 'Agent not found in organization';
  end if;
  insert into private.agent_credentials(agent_id, organization_id, owner_user_id, ciphertext, key_version, source, openai_project_id, openai_service_account_id)
  values (p_agent, p_org, p_owner, p_ciphertext, 1, p_source, p_project, p_service_account)
  on conflict (agent_id) do update set
    ciphertext = excluded.ciphertext,
    source = excluded.source,
    openai_project_id = excluded.openai_project_id,
    openai_service_account_id = excluded.openai_service_account_id,
    updated_at = now();
  update public.ai_agents set openai_sync_status = 'synced', openai_sync_error = null where id = p_agent;
end;
$$;

-- Metadata only (never the ciphertext): which kind of key and which OpenAI objects to revoke.
create function public.get_agent_openai_key_meta(p_agent uuid)
returns table(source text, openai_project_id text, openai_service_account_id text)
language sql stable security definer set search_path = '' as $$
  select source, openai_project_id, openai_service_account_id from private.agent_credentials where agent_id = p_agent;
$$;

create function public.delete_agent_openai_key(p_agent uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.agent_credentials where agent_id = p_agent;
$$;

revoke all on function public.set_agent_openai_key(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_agent_openai_key_meta(uuid) from public, anon, authenticated;
revoke all on function public.delete_agent_openai_key(uuid) from public, anon, authenticated;
grant execute on function public.set_agent_openai_key(uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.get_agent_openai_key_meta(uuid) to service_role;
grant execute on function public.delete_agent_openai_key(uuid) to service_role;

commit;

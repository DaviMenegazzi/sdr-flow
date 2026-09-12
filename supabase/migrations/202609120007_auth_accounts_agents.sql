begin;

create type public.app_role as enum ('admin','client');
create type public.account_status as enum ('invited','active','suspended','disabled');
create type public.agent_status as enum ('active','archived');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.app_role not null default 'client',
  status public.account_status not null default 'active',
  default_organization_id uuid references public.organizations(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.account_limits (
  organization_id uuid not null, owner_user_id uuid not null,
  max_agents integer not null default 2 check(max_agents between 1 and 20),
  max_instances integer check(max_instances is null or max_instances >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(organization_id,owner_user_id),
  foreign key(organization_id,owner_user_id) references public.organization_members(organization_id,user_id) on delete cascade
);
create table public.ai_agents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, owner_user_id uuid not null,
  name text not null check(length(trim(name)) between 1 and 80), description text,
  status public.agent_status not null default 'active', provider text not null, model text not null,
  system_prompt text not null default '', flow_id uuid, active_flow_version_id uuid,
  tool_policy jsonb not null default '{}', model_config jsonb not null default '{}', is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,owner_user_id,id),
  foreign key(organization_id,owner_user_id) references public.organization_members(organization_id,user_id) on delete cascade,
  foreign key(organization_id,flow_id) references public.flows(organization_id,id),
  foreign key(organization_id,flow_id,active_flow_version_id) references public.flow_versions(organization_id,flow_id,id)
);
create unique index ai_agents_one_default_per_owner on public.ai_agents(organization_id,owner_user_id) where is_default and status='active';

alter table public.connections add column owner_user_id uuid;
alter table public.connections add column agent_id uuid;
insert into public.organization_members (organization_id, user_id, role)
select distinct c.organization_id, u.id, 'owner'::public.member_role
from public.connections c
cross join lateral (
  select id from auth.users order by created_at asc limit 1
) u
where not exists (
  select 1 from public.organization_members om where om.organization_id = c.organization_id
)
on conflict do nothing;
update public.connections c set owner_user_id=(select om.user_id from public.organization_members om where om.organization_id=c.organization_id order by case om.role when 'owner' then 0 else 1 end,om.created_at limit 1) where owner_user_id is null;
insert into public.profiles(user_id,status,default_organization_id)
select distinct on (om.user_id) om.user_id,'active'::public.account_status,om.organization_id from public.organization_members om order by om.user_id,case om.role when 'owner' then 0 else 1 end,om.created_at
on conflict(user_id) do nothing;
insert into public.account_limits(organization_id,owner_user_id)
select organization_id,user_id from public.organization_members on conflict do nothing;
insert into public.ai_agents(organization_id,owner_user_id,name,provider,model,system_prompt,is_default)
select distinct c.organization_id,c.owner_user_id,'Agente padrão','openai','gpt-4.1-mini','',true from public.connections c where c.owner_user_id is not null
on conflict do nothing;
update public.connections c set agent_id=(select a.id from public.ai_agents a where a.organization_id=c.organization_id and a.owner_user_id=c.owner_user_id and a.is_default and a.status='active' limit 1) where agent_id is null;
alter table public.connections alter column owner_user_id set not null;
alter table public.connections alter column agent_id set not null;
alter table public.connections add constraint connections_owner_member_fk foreign key(organization_id,owner_user_id) references public.organization_members(organization_id,user_id);
alter table public.connections add constraint connections_owner_agent_fk foreign key(organization_id,owner_user_id,agent_id) references public.ai_agents(organization_id,owner_user_id,id) on delete restrict;
create unique index connections_org_owner_id_idx on public.connections(organization_id,owner_user_id,id);

create function private.fill_connection_owner_agent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.owner_user_id is null then select user_id into new.owner_user_id from public.organization_members where organization_id=new.organization_id and role='owner' order by created_at limit 1; end if;
 if new.owner_user_id is not null then
   insert into public.account_limits(organization_id,owner_user_id) values(new.organization_id,new.owner_user_id) on conflict do nothing;
   if not exists(select 1 from public.ai_agents where organization_id=new.organization_id and owner_user_id=new.owner_user_id and status='active') then
     insert into public.ai_agents(organization_id,owner_user_id,name,provider,model,system_prompt,is_default) values(new.organization_id,new.owner_user_id,'Agente padrão','openai','gpt-4.1-mini','',true);
   end if;
 end if;
 if new.agent_id is null then select id into new.agent_id from public.ai_agents where organization_id=new.organization_id and owner_user_id=new.owner_user_id and is_default and status='active' limit 1; end if;
 if new.owner_user_id is null or new.agent_id is null then raise exception 'Connection owner and agent are required' using errcode='23502'; end if;
 return new;
end $$;
create trigger fill_connection_scope before insert on public.connections for each row execute function private.fill_connection_owner_agent();

alter table private.connection_credentials add column organization_id uuid;
alter table private.connection_credentials add column owner_user_id uuid;
alter table private.connection_credentials add column key_version integer not null default 1;
update private.connection_credentials cc set organization_id=c.organization_id,owner_user_id=c.owner_user_id from public.connections c where c.id=cc.connection_id;
alter table private.connection_credentials alter column organization_id set not null;
alter table private.connection_credentials alter column owner_user_id set not null;
alter table private.connection_credentials add constraint connection_credentials_owner_fk foreign key(organization_id,owner_user_id,connection_id) references public.connections(organization_id,owner_user_id,id) on delete cascade;
create or replace function public.set_connection_credentials(p_org uuid,p_connection uuid,p_ciphertext text) returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin select owner_user_id into v_owner from public.connections where id=p_connection and organization_id=p_org; if not found then raise exception 'Connection not found in organization'; end if;
 insert into private.connection_credentials(connection_id,organization_id,owner_user_id,ciphertext,key_version) values(p_connection,p_org,v_owner,p_ciphertext,1)
 on conflict(connection_id) do update set organization_id=excluded.organization_id,owner_user_id=excluded.owner_user_id,ciphertext=excluded.ciphertext,key_version=excluded.key_version;
end $$;

create function private.current_profile_is_active() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where user_id=(select auth.uid()) and status='active') $$;
revoke all on function private.current_profile_is_active() from public; grant execute on function private.current_profile_is_active() to authenticated,service_role;

alter table public.profiles enable row level security; alter table public.account_limits enable row level security; alter table public.ai_agents enable row level security;
create policy profile_read_self on public.profiles for select to authenticated using(user_id=(select auth.uid()));
create policy profile_update_self on public.profiles for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select on public.profiles,public.account_limits,public.ai_agents to authenticated;
grant update(display_name,updated_at) on public.profiles to authenticated;
create policy limits_read_self on public.account_limits for select to authenticated using(owner_user_id=(select auth.uid()) and private.current_profile_is_active());
create policy agents_read_self on public.ai_agents for select to authenticated using(owner_user_id=(select auth.uid()) and private.current_profile_is_active());
create policy agents_update_self on public.ai_agents for update to authenticated using(owner_user_id=(select auth.uid()) and private.current_profile_is_active()) with check(owner_user_id=(select auth.uid()) and private.current_profile_is_active());
create policy connection_owner_select on public.connections as restrictive for select to authenticated using(owner_user_id=(select auth.uid()) and private.current_profile_is_active());
create policy connection_owner_write on public.connections as restrictive for all to authenticated using(owner_user_id=(select auth.uid()) and private.current_profile_is_active()) with check(owner_user_id=(select auth.uid()) and private.current_profile_is_active());

create function private.provision_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_agent uuid;
begin
 insert into public.organizations(name) values(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Minha conta')) returning id into v_org;
 insert into public.organization_members(organization_id,user_id,role) values(v_org,new.id,'owner');
 insert into public.profiles(user_id,display_name,role,status,default_organization_id) values(new.id,nullif(trim(new.raw_user_meta_data->>'display_name'),''),'client','active',v_org);
 insert into public.account_limits(organization_id,owner_user_id) values(v_org,new.id);
 insert into public.ai_agents(organization_id,owner_user_id,name,provider,model,system_prompt,is_default) values(v_org,new.id,'Agente padrão','openai','gpt-4.1-mini','',true) returning id into v_agent;
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.provision_new_user();

create or replace function public.create_organization(org_name text) returns uuid
language plpgsql security definer set search_path='' as $$ declare v_uid uuid:=auth.uid(); v_org uuid;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select default_organization_id into v_org from public.profiles where user_id=v_uid;
 if v_org is not null and not exists(select 1 from public.flows where organization_id=v_org) and not exists(select 1 from public.connections where organization_id=v_org) then
   update public.organizations set name=org_name where id=v_org; return v_org;
 end if;
 insert into public.organizations(name) values(org_name) returning id into v_org;
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_uid,'owner');
 insert into public.account_limits(organization_id,owner_user_id) values(v_org,v_uid);
 insert into public.ai_agents(organization_id,owner_user_id,name,provider,model,system_prompt,is_default) values(v_org,v_uid,'Agente padrão','openai','gpt-4.1-mini','',true);
 update public.profiles set default_organization_id=v_org,updated_at=now() where user_id=v_uid;
 return v_org;
end $$;

create function public.create_agent_for_current_user(p_name text,p_description text,p_provider text,p_model text,p_system_prompt text,p_tool_policy jsonb default '{}',p_model_config jsonb default '{}') returns public.ai_agents
language plpgsql security definer set search_path='' as $$ declare v_uid uuid:=auth.uid(); v_org uuid; v_limit int; v_count int; v_agent public.ai_agents;
begin
 select default_organization_id into v_org from public.profiles where user_id=v_uid and status='active'; if v_org is null then raise exception 'Account not found' using errcode='P0002'; end if;
 select max_agents into v_limit from public.account_limits where organization_id=v_org and owner_user_id=v_uid for update;
 select count(*) into v_count from public.ai_agents where organization_id=v_org and owner_user_id=v_uid and status='active';
 if v_count>=v_limit then raise exception 'Agent limit reached' using errcode='P0001'; end if;
 insert into public.ai_agents(organization_id,owner_user_id,name,description,provider,model,system_prompt,tool_policy,model_config) values(v_org,v_uid,p_name,p_description,p_provider,p_model,p_system_prompt,p_tool_policy,p_model_config) returning * into v_agent;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values(v_org,v_uid,'agent.created',v_agent.id,'{}'); return v_agent;
end $$;
revoke all on function public.create_agent_for_current_user(text,text,text,text,text,jsonb,jsonb) from public; grant execute on function public.create_agent_for_current_user(text,text,text,text,text,jsonb,jsonb) to authenticated;

create function public.assign_agent_to_connection(p_connection uuid,p_agent uuid) returns public.connections language plpgsql security definer set search_path='' as $$ declare v_uid uuid:=auth.uid(); v_org uuid; v_conn public.connections;
begin select default_organization_id into v_org from public.profiles where user_id=v_uid and status='active';
 update public.connections c set agent_id=p_agent,updated_at=now() where c.id=p_connection and c.organization_id=v_org and c.owner_user_id=v_uid and exists(select 1 from public.ai_agents a where a.id=p_agent and a.organization_id=v_org and a.owner_user_id=v_uid and a.status='active') returning * into v_conn;
 if not found then raise exception 'Resource not found' using errcode='P0002'; end if;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values(v_org,v_uid,'connection.agent_assigned',p_connection,jsonb_build_object('agent_id',p_agent)); return v_conn;
end $$;
revoke all on function public.assign_agent_to_connection(uuid,uuid) from public; grant execute on function public.assign_agent_to_connection(uuid,uuid) to authenticated;

create function public.admin_list_accounts() returns table(user_id uuid,display_name text,role public.app_role,status public.account_status,organization_id uuid,max_agents int,max_instances int)
language sql stable security definer set search_path='' as $$ select p.user_id,p.display_name,p.role,p.status,p.default_organization_id,l.max_agents,l.max_instances from public.profiles p left join public.account_limits l on l.organization_id=p.default_organization_id and l.owner_user_id=p.user_id where exists(select 1 from public.profiles me where me.user_id=auth.uid() and me.role='admin' and me.status='active') $$;
revoke all on function public.admin_list_accounts() from public; grant execute on function public.admin_list_accounts() to authenticated;

grant all on public.profiles,public.account_limits,public.ai_agents to service_role;
commit;

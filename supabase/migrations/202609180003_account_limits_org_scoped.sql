begin;

-- account_limits.owner_user_id let each invited org member accumulate their own agent/
-- instance allowance (2 agents + unlimited instances by default) instead of the org sharing
-- one cap, so inviting N members multiplied real capacity by N. Limits gate an organization's
-- resources, not a member's -- collapse to one row per organization.

with merged as (
  select organization_id,
         max(max_agents) as max_agents,
         min(max_instances) filter (where max_instances is not null) as max_instances
  from public.account_limits
  group by organization_id
)
update public.account_limits al set max_agents = m.max_agents, max_instances = m.max_instances
from merged m where al.organization_id = m.organization_id;

delete from public.account_limits a using public.account_limits b
where a.organization_id = b.organization_id and a.owner_user_id > b.owner_user_id;

alter table public.account_limits drop constraint account_limits_pkey;
alter table public.account_limits drop constraint account_limits_organization_id_owner_user_id_fkey;
alter table public.account_limits add primary key (organization_id);
alter table public.account_limits drop column owner_user_id;

create or replace function private.provision_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_agent uuid;
begin
 insert into public.organizations(name) values(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Minha conta')) returning id into v_org;
 insert into public.organization_members(organization_id,user_id,role) values(v_org,new.id,'owner');
 insert into public.profiles(user_id,display_name,role,status,default_organization_id) values(new.id,nullif(trim(new.raw_user_meta_data->>'display_name'),''),'client','active',v_org);
 insert into public.account_limits(organization_id) values(v_org);
 insert into public.ai_agents(organization_id,owner_user_id,name,provider,model,system_prompt,is_default) values(v_org,new.id,'Agente padrão','openai','gpt-4.1-mini','',true) returning id into v_agent;
 return new;
end $$;

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
 insert into public.account_limits(organization_id) values(v_org);
 insert into public.ai_agents(organization_id,owner_user_id,name,provider,model,system_prompt,is_default) values(v_org,v_uid,'Agente padrão','openai','gpt-4.1-mini','',true);
 update public.profiles set default_organization_id=v_org,updated_at=now() where user_id=v_uid;
 return v_org;
end $$;

create or replace function public.create_agent_for_current_user(p_name text,p_description text,p_provider text,p_model text,p_system_prompt text,p_tool_policy jsonb default '{}',p_model_config jsonb default '{}') returns public.ai_agents
language plpgsql security definer set search_path='' as $$ declare v_uid uuid:=auth.uid(); v_org uuid; v_limit int; v_count int; v_agent public.ai_agents;
begin
 select default_organization_id into v_org from public.profiles where user_id=v_uid and status='active'; if v_org is null then raise exception 'Account not found' using errcode='P0002'; end if;
 select max_agents into v_limit from public.account_limits where organization_id=v_org for update;
 select count(*) into v_count from public.ai_agents where organization_id=v_org and status='active';
 if v_count>=v_limit then raise exception 'Agent limit reached' using errcode='P0001'; end if;
 insert into public.ai_agents(organization_id,owner_user_id,name,description,provider,model,system_prompt,tool_policy,model_config) values(v_org,v_uid,p_name,p_description,p_provider,p_model,p_system_prompt,p_tool_policy,p_model_config) returning * into v_agent;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values(v_org,v_uid,'agent.created',v_agent.id,'{}'); return v_agent;
end $$;

create or replace function private.enforce_agent_limit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  select max_agents into v_limit from public.account_limits where organization_id = new.organization_id;
  if v_limit is null then v_limit := 2; end if;
  select count(*) into v_count from public.ai_agents where organization_id = new.organization_id and status = 'active';
  if v_count >= v_limit then raise exception 'Agent limit reached' using errcode = 'P0001'; end if;
  return new;
end $$;

create or replace function private.enforce_instance_limit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  select max_instances into v_limit from public.account_limits where organization_id = new.organization_id;
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.connections where organization_id = new.organization_id;
  if v_count >= v_limit then raise exception 'Instance limit reached' using errcode = 'P0001'; end if;
  return new;
end $$;

create or replace function private.fill_connection_owner_agent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.owner_user_id is null then select user_id into new.owner_user_id from public.organization_members where organization_id=new.organization_id and role='owner' order by created_at limit 1; end if;
 if new.owner_user_id is not null then
   insert into public.account_limits(organization_id) values(new.organization_id) on conflict do nothing;
   if not exists(select 1 from public.ai_agents where organization_id=new.organization_id and owner_user_id=new.owner_user_id and status='active') then
     insert into public.ai_agents(organization_id,owner_user_id,name,provider,model,system_prompt,is_default) values(new.organization_id,new.owner_user_id,'Agente padrão','openai','gpt-4.1-mini','',true);
   end if;
 end if;
 if new.agent_id is null then select id into new.agent_id from public.ai_agents where organization_id=new.organization_id and owner_user_id=new.owner_user_id and is_default and status='active' limit 1; end if;
 if new.owner_user_id is null or new.agent_id is null then raise exception 'Connection owner and agent are required' using errcode='23502'; end if;
 return new;
end $$;

-- admin_update_account_limits still takes a member's user id from the admin UI, resolved to
-- their org, but now sets the org's single shared cap instead of that member's own row.
create or replace function public.admin_update_account_limits(p_user uuid,p_max_agents int,p_max_instances int) returns public.account_limits
language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid(); v_org uuid; v_limits public.account_limits;
begin if not exists(select 1 from public.profiles where user_id=v_actor and role='admin' and status='active') then raise exception 'Resource not found' using errcode='P0002'; end if;
 if p_max_agents not between 1 and 20 or p_max_instances is not null and p_max_instances<0 then raise exception 'Invalid limits'; end if;
 select default_organization_id into v_org from public.profiles where user_id=p_user; if v_org is null then raise exception 'Resource not found' using errcode='P0002'; end if;
 update public.account_limits set max_agents=p_max_agents,max_instances=p_max_instances,updated_at=now() where organization_id=v_org returning * into v_limits;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values(v_org,v_actor,'account.limits_changed',p_user,jsonb_build_object('max_agents',p_max_agents,'max_instances',p_max_instances)); return v_limits; end $$;

create or replace function public.admin_list_accounts() returns table(user_id uuid,display_name text,role public.app_role,status public.account_status,organization_id uuid,max_agents int,max_instances int)
language sql stable security definer set search_path='' as $$ select p.user_id,p.display_name,p.role,p.status,p.default_organization_id,l.max_agents,l.max_instances from public.profiles p left join public.account_limits l on l.organization_id=p.default_organization_id where exists(select 1 from public.profiles me where me.user_id=auth.uid() and me.role='admin' and me.status='active') $$;

commit;

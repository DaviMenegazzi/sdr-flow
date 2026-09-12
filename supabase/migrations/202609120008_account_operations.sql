begin;

create function public.update_agent_for_current_user(p_agent uuid,p_name text,p_description text,p_provider text,p_model text,p_system_prompt text,p_tool_policy jsonb,p_model_config jsonb)
returns public.ai_agents language plpgsql security definer set search_path='' as $$ declare v_uid uuid:=auth.uid(); v_agent public.ai_agents;
begin update public.ai_agents set name=p_name,description=p_description,provider=p_provider,model=p_model,system_prompt=p_system_prompt,tool_policy=p_tool_policy,model_config=p_model_config,updated_at=now()
 where id=p_agent and owner_user_id=v_uid and status='active' returning * into v_agent;
 if not found then raise exception 'Resource not found' using errcode='P0002'; end if; return v_agent; end $$;
revoke all on function public.update_agent_for_current_user(uuid,text,text,text,text,text,jsonb,jsonb) from public;
grant execute on function public.update_agent_for_current_user(uuid,text,text,text,text,text,jsonb,jsonb) to authenticated;

create function public.archive_agent_for_current_user(p_agent uuid) returns public.ai_agents
language plpgsql security definer set search_path='' as $$ declare v_uid uuid:=auth.uid(); v_agent public.ai_agents;
begin
 if exists(select 1 from public.connections where owner_user_id=v_uid and agent_id=p_agent) then raise exception 'Agent is assigned to a connection' using errcode='23503'; end if;
 update public.ai_agents set status='archived',is_default=false,updated_at=now() where id=p_agent and owner_user_id=v_uid and status='active' and not is_default returning * into v_agent;
 if not found then raise exception 'Resource not found' using errcode='P0002'; end if;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values(v_agent.organization_id,v_uid,'agent.archived',v_agent.id,'{}'); return v_agent;
end $$;
revoke all on function public.archive_agent_for_current_user(uuid) from public; grant execute on function public.archive_agent_for_current_user(uuid) to authenticated;

create function public.admin_update_account_status(p_user uuid,p_status public.account_status) returns public.profiles
language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid(); v_profile public.profiles;
begin if not exists(select 1 from public.profiles where user_id=v_actor and role='admin' and status='active') then raise exception 'Resource not found' using errcode='P0002'; end if;
 update public.profiles set status=p_status,updated_at=now() where user_id=p_user returning * into v_profile; if not found then raise exception 'Resource not found' using errcode='P0002'; end if;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values(v_profile.default_organization_id,v_actor,'account.status_changed',p_user,jsonb_build_object('status',p_status)); return v_profile; end $$;
revoke all on function public.admin_update_account_status(uuid,public.account_status) from public; grant execute on function public.admin_update_account_status(uuid,public.account_status) to authenticated;

create function public.admin_update_account_limits(p_user uuid,p_max_agents int,p_max_instances int) returns public.account_limits
language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=auth.uid(); v_org uuid; v_limits public.account_limits;
begin if not exists(select 1 from public.profiles where user_id=v_actor and role='admin' and status='active') then raise exception 'Resource not found' using errcode='P0002'; end if;
 if p_max_agents not between 1 and 20 or p_max_instances is not null and p_max_instances<0 then raise exception 'Invalid limits'; end if;
 select default_organization_id into v_org from public.profiles where user_id=p_user; if v_org is null then raise exception 'Resource not found' using errcode='P0002'; end if;
 update public.account_limits set max_agents=p_max_agents,max_instances=p_max_instances,updated_at=now() where organization_id=v_org and owner_user_id=p_user returning * into v_limits;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,details) values(v_org,v_actor,'account.limits_changed',p_user,jsonb_build_object('max_agents',p_max_agents,'max_instances',p_max_instances)); return v_limits; end $$;
revoke all on function public.admin_update_account_limits(uuid,int,int) from public; grant execute on function public.admin_update_account_limits(uuid,int,int) to authenticated;

-- Carry explicit connection ownership through operational records. Existing rows are backfilled from their parent connection.
alter table public.leads add column if not exists owner_user_id uuid;
alter table public.leads add column if not exists connection_id uuid;
update public.leads l set connection_id=(select cv.connection_id from public.conversations cv where cv.organization_id=l.organization_id and cv.lead_id=l.id order by cv.created_at limit 1) where l.connection_id is null;
update public.leads l set owner_user_id=c.owner_user_id from public.connections c where c.organization_id=l.organization_id and c.id=l.connection_id and l.owner_user_id is null;
update public.leads l set connection_id=(select c.id from public.connections c where c.organization_id=l.organization_id order by c.created_at limit 1) where l.connection_id is null;
update public.leads l set owner_user_id=c.owner_user_id from public.connections c where c.organization_id=l.organization_id and c.id=l.connection_id and l.owner_user_id is null;
alter table public.leads add constraint leads_connection_owner_fk foreign key(organization_id,owner_user_id,connection_id) references public.connections(organization_id,owner_user_id,id);
create index if not exists leads_instance_idx on public.leads(organization_id,owner_user_id,connection_id);
alter table public.leads
  drop constraint if exists leads_organization_id_phone_key;
create unique index if not exists leads_instance_phone_key on public.leads(organization_id,connection_id,phone) where connection_id is not null;
alter table public.leads add constraint leads_scope_unique unique(organization_id,owner_user_id,connection_id,id);

alter table public.deals add column if not exists owner_user_id uuid;
alter table public.deals add column if not exists connection_id uuid;
update public.deals d set connection_id=l.connection_id,owner_user_id=l.owner_user_id from public.leads l where l.organization_id=d.organization_id and l.id=d.lead_id;
alter table public.deals add constraint deals_instance_lead_fk foreign key(organization_id,owner_user_id,connection_id,lead_id) references public.leads(organization_id,owner_user_id,connection_id,id);

alter table public.knowledge_documents add column if not exists owner_user_id uuid;
alter table public.knowledge_documents add column if not exists connection_id uuid;
update public.knowledge_documents k set owner_user_id=p.user_id from public.profiles p where p.default_organization_id=k.organization_id and k.owner_user_id is null;
alter table public.knowledge_documents add constraint knowledge_instance_fk foreign key(organization_id,owner_user_id,connection_id) references public.connections(organization_id,owner_user_id,id);
create index if not exists knowledge_instance_idx on public.knowledge_documents(organization_id,owner_user_id,connection_id,collection);

alter table public.connections force row level security;
alter table public.ai_agents force row level security;
alter table public.account_limits force row level security;
commit;

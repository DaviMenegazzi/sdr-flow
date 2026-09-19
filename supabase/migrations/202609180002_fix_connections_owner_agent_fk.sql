begin;

-- connections_owner_agent_fk required agent.owner_user_id to match connection.owner_user_id,
-- so assigning an org-mate's agent to a connection failed with 23503. Agents are already
-- org-scoped; drop the owner_user_id leg and key the FK on (organization_id, id) instead.
alter table public.ai_agents add constraint ai_agents_org_id_uidx unique(organization_id,id);
alter table public.connections drop constraint connections_owner_agent_fk;
alter table public.connections add constraint connections_owner_agent_fk
  foreign key(organization_id,agent_id) references public.ai_agents(organization_id,id) on delete restrict;

commit;

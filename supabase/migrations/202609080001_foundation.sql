begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.member_role as enum ('owner', 'admin', 'agent', 'viewer');
create type public.connection_provider as enum ('evolution', 'meta');
create type public.conversation_stage as enum ('NEW_CONVERSATION', 'QUALIFYING', 'COLLECTING_INFORMATION', 'PRESENTING_SOLUTION', 'NEGOTIATING', 'CONVERTED', 'HUMAN_HANDOFF', 'CLOSED');

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 120), created_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade, role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(), primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id, organization_id);

-- Non-recursive membership lookup. Only the current JWT identity is accepted.
create function private.org_role(org uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select role from public.organization_members where organization_id = org and user_id = (select auth.uid())
$$;
revoke all on function private.org_role(uuid) from public;
grant execute on function private.org_role(uuid) to authenticated, service_role;

create table public.flows (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120), draft jsonb not null,
  published_version_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), check (jsonb_typeof(draft) = 'object')
);
create table public.flow_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, flow_id uuid not null,
  version integer not null check (version > 0), graph jsonb not null check (jsonb_typeof(graph) = 'object'),
  created_by uuid references auth.users on delete set null, created_at timestamptz not null default now(),
  foreign key (organization_id, flow_id) references public.flows(organization_id, id) on delete cascade,
  unique (flow_id, version), unique (organization_id, id), unique (organization_id, flow_id, id)
);
alter table public.flows add constraint flows_published_version_fk foreign key (organization_id, id, published_version_id)
  references public.flow_versions(organization_id, flow_id, id) deferrable initially deferred;

create table public.connections (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
  name text not null, provider public.connection_provider not null, status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'connected', 'error')),
  phone text, provider_instance_id text, created_at timestamptz not null default now(), unique (organization_id, id)
);
-- Provider credentials belong in a separate private store, never in the API-visible row.
create table private.connection_credentials (
  connection_id uuid primary key references public.connections on delete cascade, ciphertext text not null
);
alter table private.connection_credentials enable row level security;
create table public.leads (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
  phone text not null, name text, city text, interest text, urgency text,
  memory jsonb not null default '{}' check (jsonb_typeof(memory) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, phone)
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, connection_id uuid not null, lead_id uuid not null,
  flow_version_id uuid, stage public.conversation_stage not null default 'NEW_CONVERSATION',
  bot_paused boolean not null default false, handled_by text not null default 'AI' check (handled_by in ('AI','HUMAN','SYSTEM')),
  assigned_user_id uuid, last_message_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, connection_id, id),
  foreign key (organization_id, connection_id) references public.connections(organization_id,id),
  foreign key (organization_id, lead_id) references public.leads(organization_id,id),
  foreign key (organization_id, flow_version_id) references public.flow_versions(organization_id,id),
  foreign key (organization_id, assigned_user_id) references public.organization_members(organization_id,user_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, connection_id uuid not null, conversation_id uuid not null,
  provider_message_id text, direction text not null check (direction in ('INBOUND','OUTBOUND')),
  sender text not null check (sender in ('lead','ai','human','system')), content text not null, message_type text not null default 'text',
  created_at timestamptz not null default now(), unique (organization_id,id),
  foreign key (organization_id,connection_id,conversation_id) references public.conversations(organization_id,connection_id,id),
  unique (organization_id,connection_id,provider_message_id)
);
create index messages_conversation_time_idx on public.messages(organization_id,conversation_id,created_at desc,id);
create table public.deals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, lead_id uuid not null, title text not null,
  status text not null default 'OPEN' check (status in ('OPEN','WON','LOST')), score integer check (score between 0 and 100),
  created_at timestamptz not null default now(), unique (organization_id,id),
  foreign key (organization_id,lead_id) references public.leads(organization_id,id)
);
create table public.flow_executions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, conversation_id uuid not null, flow_version_id uuid not null,
  status text not null default 'queued' check (status in ('queued','running','waiting','completed','failed')),
  input_tokens integer not null default 0 check (input_tokens >= 0), output_tokens integer not null default 0 check (output_tokens >= 0),
  resume_node_id text, created_at timestamptz not null default now(), finished_at timestamptz,
  unique (organization_id,id), foreign key (organization_id,conversation_id) references public.conversations(organization_id,id),
  foreign key (organization_id,flow_version_id) references public.flow_versions(organization_id,id)
);
create table public.flow_execution_steps (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, execution_id uuid not null,
  node_id text not null, sequence integer not null, input jsonb, output jsonb, duration_ms integer check (duration_ms >= 0), error text,
  created_at timestamptz not null default now(), unique (execution_id,sequence),
  foreign key (organization_id,execution_id) references public.flow_executions(organization_id,id) on delete cascade
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
  actor_id uuid references auth.users on delete set null, action text not null, entity_id uuid, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Supabase may have permissive default grants: replace them explicitly for these tables.
revoke all on public.organizations, public.organization_members, public.flows, public.flow_versions,
  public.connections, public.leads, public.conversations, public.messages, public.deals,
  public.flow_executions, public.flow_execution_steps, public.audit_events from anon, authenticated;
revoke all on private.connection_credentials from public, anon, authenticated;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
create policy organization_read on public.organizations for select to authenticated using (private.org_role(id) is not null);
create policy membership_read on public.organization_members for select to authenticated using (private.org_role(organization_id) is not null);
grant select on public.organizations, public.organization_members to authenticated;

do $$ declare table_name text; begin
  foreach table_name in array array['flows','flow_versions','connections','leads','conversations','messages','deals','flow_executions','flow_execution_steps','audit_events'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy org_read on public.%I for select to authenticated using (private.org_role(organization_id) is not null)',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('create index on public.%I (organization_id)',table_name);
  end loop;
end $$;
create policy flow_insert on public.flows for insert to authenticated with check (private.org_role(organization_id) in ('owner','admin'));
create policy flow_update on public.flows for update to authenticated using (private.org_role(organization_id) in ('owner','admin')) with check (private.org_role(organization_id) in ('owner','admin'));
-- Users can edit drafts; only the server publication transaction changes the pointer.
grant insert (organization_id,name,draft), update (name,draft,updated_at) on public.flows to authenticated;
grant all on all tables in schema public to service_role;
grant all on private.connection_credentials to service_role;

create function public.create_organization(org_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare org_id uuid; begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.organizations(name) values (org_name) returning id into org_id;
  insert into public.organization_members(organization_id,user_id,role) values (org_id,auth.uid(),'owner');
  return org_id;
end $$;
revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

-- Called only by the API after Zod + graph validation. Never exposed to end-user roles.
-- The actor is rechecked here and the parent lock serializes concurrent publishers.
create function public.publish_flow(p_org uuid, p_flow uuid, p_actor uuid, p_graph jsonb) returns public.flow_versions
language plpgsql security definer set search_path = '' as $$
declare published public.flow_versions; next_version integer; begin
  if not exists (select 1 from public.organization_members where organization_id=p_org and user_id=p_actor and role in ('owner','admin'))
    then raise exception 'Publication forbidden' using errcode = '42501'; end if;
  perform 1 from public.flows where id=p_flow and organization_id=p_org for update;
  if not found then raise exception 'Flow not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_graph) <> 'object' or p_graph->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_graph->'nodes') is distinct from 'array' or jsonb_typeof(p_graph->'edges') is distinct from 'array'
    then raise exception 'Invalid graph'; end if;
  select coalesce(max(version),0)+1 into next_version from public.flow_versions where flow_id=p_flow;
  insert into public.flow_versions(organization_id,flow_id,version,graph,created_by)
    values(p_org,p_flow,next_version,p_graph,p_actor) returning * into published;
  update public.flows set published_version_id=published.id, updated_at=now() where id=p_flow and organization_id=p_org;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,details)
    values(p_org,p_actor,'flow.published',p_flow,jsonb_build_object('version',next_version,'version_id',published.id));
  return published;
end $$;
revoke all on function public.publish_flow(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.publish_flow(uuid,uuid,uuid,jsonb) to service_role;

create function private.reject_version_update() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Published flow versions are immutable'; end $$;
create trigger immutable_flow_version before update on public.flow_versions for each row execute function private.reject_version_update();
commit;

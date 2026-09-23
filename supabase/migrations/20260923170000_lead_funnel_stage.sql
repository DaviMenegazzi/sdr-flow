begin;

-- conversations.stage is per session: it is closed after SESSION_TIMEOUT_MINUTES of silence and
-- the next message opens a fresh NEW_CONVERSATION row. The sales funnel has to survive that, so
-- it lives on the lead. lead_score/temperature come from the Laya classifier (not the LLM).
alter table public.leads
  add column funnel_stage public.conversation_stage not null default 'NEW_CONVERSATION',
  add column funnel_stage_updated_at timestamptz,
  add column lead_score smallint check (lead_score between 0 and 100),
  add column temperature text check (temperature in ('HOT', 'WARM', 'COLD')),
  add column lead_score_updated_at timestamptz;

create index leads_org_funnel_stage_idx on public.leads(organization_id, funnel_stage);

-- Every automatic funnel move, with the signal that caused it, so a wrong move can be traced.
create table public.lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  conversation_id uuid,
  from_stage public.conversation_stage not null,
  to_stage public.conversation_stage not null,
  source text not null check (source in ('flow_signal', 'text_rule', 'laya')),
  reason text not null,
  evidence text,
  confidence real check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete set null (conversation_id)
);
create index lead_stage_events_lead_idx on public.lead_stage_events(organization_id, lead_id, created_at desc);

alter table public.lead_stage_events enable row level security;
create policy lead_stage_events_read on public.lead_stage_events for select to authenticated
  using (private.org_role(organization_id) is not null);

grant select on public.lead_stage_events to authenticated;
grant all on public.lead_stage_events to service_role;

commit;

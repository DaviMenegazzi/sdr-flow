-- Admin execution log ("Logs de Execução"): flow_executions already records
-- input_tokens/output_tokens/status per turn, but not which instance, lead, agent or OpenAI
-- model produced it. Those were only ever implicit via conversation_id, resolvable only by
-- joining through conversations' *current* connection_id/lead_id — which silently rewrites
-- history if a lead's conversation is ever reassigned. This denormalizes the four
-- identifying fields directly onto flow_executions, captured once at turn-processor.ts's
-- createExecution() call, next to the tokens it already captures, so a later change never
-- edits an execution already logged.
--
-- All four are nullable: pre-existing rows predate these columns (connection_id/lead_id are
-- backfilled below from conversations, which already carries both for every historical row;
-- agent_id/model cannot be recovered this way and stay null for pre-migration executions).
-- Any future turn that fails before reaching agent/model resolution (no_agent_pinned,
-- missing_openai_key, invalid_flow_version) still creates no flow_executions row at all (see
-- turn-processor.ts), so every row created from here on will always carry all four values.
alter table public.flow_executions add column if not exists connection_id uuid;
alter table public.flow_executions add column if not exists lead_id uuid;
alter table public.flow_executions add column if not exists agent_id uuid;
alter table public.flow_executions add column if not exists model text;

-- Composite FKs, matching how conversations/inbound_events already reference connections and
-- leads: (organization_id, x) -> (organization_id, id). Nullable columns are exempt from FK
-- enforcement under Postgres's default MATCH SIMPLE (a null connection_id/lead_id trivially
-- satisfies the constraint). ai_agents has no (organization_id, id) unique constraint (only
-- the 3-column (organization_id, owner_user_id, id) from
-- 202609120007_auth_accounts_agents.sql), so agent_id gets a plain single-column FK to its
-- primary key instead of the composite pattern used above.
--
-- ON DELETE SET NULL on all three, never CASCADE/RESTRICT: this is an audit trail — deleting
-- a connection, lead or agent later must not delete, or be blocked by, the executions that
-- already ran under it. The connection/lead FKs are composite (organization_id, x): a plain
-- "on delete set null" on a multi-column FK nulls every column of the key, including
-- organization_id — which is NOT NULL on flow_executions and would make the delete itself
-- fail. The column-list form (Postgres 15+) scopes the SET NULL to just connection_id/lead_id.
alter table public.flow_executions add constraint flow_executions_connection_fk
  foreign key (organization_id, connection_id) references public.connections(organization_id, id) on delete set null (connection_id);
alter table public.flow_executions add constraint flow_executions_lead_fk
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete set null (lead_id);
alter table public.flow_executions add constraint flow_executions_agent_fk
  foreign key (agent_id) references public.ai_agents(id) on delete set null;

-- Backfill from conversations, which has carried connection_id/lead_id (both not-null) since
-- the foundation migration for every conversation ever created. Idempotent: only touches rows
-- this migration just nulled out, so a rerun is a no-op.
update public.flow_executions fe
  set connection_id = c.connection_id, lead_id = c.lead_id
  from public.conversations c
  where c.organization_id = fe.organization_id and c.id = fe.conversation_id
    and fe.connection_id is null;

-- Primary access pattern for the new admin log screen: "this instance's executions, newest
-- first" — the instance selector always scopes to one active connection.
create index if not exists flow_executions_org_connection_time_idx
  on public.flow_executions(organization_id, connection_id, created_at desc);

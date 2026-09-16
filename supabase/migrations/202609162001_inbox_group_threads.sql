begin;

-- Phase 2 of the group-identity fix (docs/RELATORIO_DEBUG_INBOX.md's sibling issue): the Inbox
-- still rendered one card per public.conversations row. A session is closed and a new one opened
-- for the same lead after every SESSION_TIMEOUT_MINUTES gap (see
-- 202609151001_conversations_one_active_per_lead.sql), so a chatty WhatsApp group accumulates
-- several conversation rows and therefore several cards for what is, to the person reading the
-- Inbox, a single ongoing chat. Fixing this by changing what a "conversation" means would touch
-- session/handoff semantics that are deliberately per-session. Instead this adds a read-only
-- projection: one thread per (organization_id, connection_id, lead_id), represented by its most
-- recently active conversation — every existing action (takeover/release/assign/stage/messages)
-- keeps operating on that conversation's id exactly as before, unchanged.

-- Tracks the last time a group's title was actually confirmed against Evolution (as opposed to
-- the "Grupo • <id>" placeholder used while Evolution is unreachable) — read by the manual resync
-- script (scripts/backfill-group-inbox.ts) to report staleness after a WhatsApp rename.
alter table public.leads
  add column if not exists group_subject_synced_at timestamptz;

-- Supports both the thread ranking below and the existing "most recent conversation for this
-- lead" lookups in ConversationRepository.
create index if not exists conversations_thread_activity_idx
  on public.conversations (organization_id, connection_id, lead_id, (coalesce(last_message_at, created_at)) desc);

-- Returns one representative conversation id per (connection_id, lead_id) thread — the most
-- recently active session — plus the total distinct-thread count for pagination, already
-- filtered and ordered. Deliberately returns only ids: InboxRepository.listConversations does
-- the lead/connection/deal/last_message enrichment exactly as it already did, just against this
-- deduped id list instead of the raw conversations table.
--
-- No SECURITY DEFINER: this runs as the calling role, so the org_read RLS policy on
-- conversations/leads/messages (202609080001_foundation.sql) already scopes results to
-- organizations the caller belongs to — service_role bypasses RLS as usual. That is simpler and
-- safer than reimplementing the membership check by hand.
create function public.list_inbox_threads(
  p_organization_id uuid,
  p_connection_id uuid default null,
  p_stage text default null,
  p_handled_by text default null,
  p_assigned_user_id uuid default null,
  p_unassigned boolean default false,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table(id uuid, total_count bigint)
language sql stable set search_path = '' as $$
  with scoped as (
    select
      c.id,
      coalesce(c.last_message_at, c.created_at) as activity_at,
      row_number() over (
        partition by c.connection_id, c.lead_id
        order by coalesce(c.last_message_at, c.created_at) desc, c.created_at desc
      ) as rn
    from public.conversations c
    join public.leads l on l.id = c.lead_id and l.organization_id = c.organization_id
    left join lateral (
      select content from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ) m_last on true
    where c.organization_id = p_organization_id
      and (p_connection_id is null or c.connection_id = p_connection_id)
      and (p_stage is null or c.stage::text = p_stage)
      and (p_handled_by is null or c.handled_by = p_handled_by)
      and (not p_unassigned or c.assigned_user_id is null)
      and (p_unassigned or p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      and (
        p_search is null or length(trim(p_search)) = 0
        or lower(coalesce(l.name, '')) like ('%' || lower(trim(p_search)) || '%')
        or lower(l.phone) like ('%' || lower(trim(p_search)) || '%')
        or lower(coalesce(m_last.content, '')) like ('%' || lower(trim(p_search)) || '%')
      )
  ),
  threads as (
    select id, activity_at, count(*) over () as total_count
    from scoped
    where rn = 1
  )
  select id, total_count
  from threads
  order by activity_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;
revoke all on function public.list_inbox_threads(uuid,uuid,text,text,uuid,boolean,text,integer,integer) from public, anon;
grant execute on function public.list_inbox_threads(uuid,uuid,text,text,uuid,boolean,text,integer,integer) to authenticated, service_role;

-- Merges message history across every session (conversation row) of the same thread, so opening
-- a group's card shows everything Emanuel/Davi/Helenara ever sent, not just the latest session's
-- slice. p_conversation_id identifies the thread the same way a card's id already does — its own
-- (connection_id, lead_id) pair. Same RLS-delegation reasoning as list_inbox_threads above.
create function public.get_thread_messages(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_limit integer default 200
) returns setof public.messages
language sql stable set search_path = '' as $$
  with target as (
    select connection_id, lead_id from public.conversations
    where organization_id = p_organization_id and id = p_conversation_id
  ),
  thread_ids as (
    select c.id from public.conversations c, target t
    where c.organization_id = p_organization_id
      and c.connection_id = t.connection_id
      and c.lead_id = t.lead_id
  ),
  recent as (
    select m.* from public.messages m
    where m.organization_id = p_organization_id
      and m.conversation_id in (select id from thread_ids)
    order by m.created_at desc
    limit greatest(p_limit, 0)
  )
  select * from recent order by created_at asc
$$;
revoke all on function public.get_thread_messages(uuid,uuid,integer) from public, anon;
grant execute on function public.get_thread_messages(uuid,uuid,integer) to authenticated, service_role;

commit;

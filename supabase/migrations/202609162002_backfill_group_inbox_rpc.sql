begin;

-- Plan item 8 (backfill): recovers what the pre-fix code path never captured. Confined to the
-- window inbound_events actually covers (202609141001_inbound_events.sql onward) — a message
-- received before that migration has no inbound_event to recover sender_name/group evidence
-- from, and this deliberately does not invent data for it. Run manually via
-- scripts/backfill-group-inbox.ts (also the "group renamed in WhatsApp" resync command from plan
-- item 2 — it re-resolves group_subject via Evolution after this RPC's pure-SQL pass).
create function public.backfill_group_inbox(p_organization_id uuid default null)
returns table(leads_marked_group integer, messages_sender_backfilled integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_leads_marked integer := 0;
  v_messages_backfilled integer := 0;
begin
  -- 1) Mark leads as groups when evidenced by any inbound_events row for that same
  -- (organization_id, connection_id, phone) whose normalized payload says so. Never writes
  -- group_subject here — that stays the exclusive job of syncGroupIdentity (live path and the
  -- resync step below), so a lead flagged here keeps its "Grupo • <id>" placeholder until a real
  -- name is resolved, and is never renamed to a participant's pushName.
  with evidence as (
    select distinct l.id as lead_id
    from public.leads l
    join public.inbound_events ie
      on ie.organization_id = l.organization_id
     and ie.connection_id = l.connection_id
     and ie.normalized_payload->>'phone' = l.phone
    where l.is_group = false
      and (p_organization_id is null or l.organization_id = p_organization_id)
      and coalesce(ie.normalized_payload->>'isGroup', 'false') = 'true'
  )
  update public.leads l
    set is_group = true, updated_at = now()
    from evidence e
    where l.id = e.lead_id;
  get diagnostics v_leads_marked = row_count;

  -- 2) Copy historical sender_name/sender_jid from the matching inbound_events row, joined by
  -- provider_message_id (each message and its originating event share the same
  -- (organization_id, connection_id, provider_message_id) tuple, unique on both sides). Only
  -- fills rows the live path never touched, and only with what the original payload actually
  -- had — a null sender_jid in the source payload stays null, never fabricated.
  with matched as (
    select m.id as message_id,
      nullif(ie.normalized_payload->>'senderName', '') as sender_name,
      nullif(ie.normalized_payload->>'senderJid', '') as sender_jid
    from public.messages m
    join public.inbound_events ie
      on ie.organization_id = m.organization_id
     and ie.connection_id = m.connection_id
     and ie.provider_message_id = m.provider_message_id
    where m.sender_name is null
      and m.direction = 'INBOUND'
      and m.provider_message_id is not null
      and (p_organization_id is null or m.organization_id = p_organization_id)
      and (ie.normalized_payload->>'senderName' is not null or ie.normalized_payload->>'senderJid' is not null)
  )
  update public.messages m
    set sender_name = matched.sender_name, sender_jid = matched.sender_jid
    from matched
    where m.id = matched.message_id;
  get diagnostics v_messages_backfilled = row_count;

  return query select v_leads_marked, v_messages_backfilled;
end $$;
revoke all on function public.backfill_group_inbox(uuid) from public, anon, authenticated;
grant execute on function public.backfill_group_inbox(uuid) to service_role;

commit;

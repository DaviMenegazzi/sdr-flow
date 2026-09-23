begin;

-- One-off data repair. Until apps/api/src/webhook.ts stopped passing it, a fromMe message
-- (sent from the connected phone itself) created the lead with Evolution's pushName, which on
-- fromMe is the instance owner's own profile name, not the contact's. find_or_create_lead keeps
-- the first non-null name, so the contact's real pushName never replaced it afterwards.
--
-- A lead is repaired only when its name matches the senderName of a fromMe inbound_event for that
-- same (organization, connection, phone): that is exactly the value the bug wrote. The name is
-- replaced by the latest pushName the contact itself sent (INBOUND messages.sender_name), or
-- cleared when the contact never wrote back, so the next inbound message fills it in.
with wrong as (
  select distinct l.id, l.organization_id, l.name
  from public.leads l
  join public.inbound_events ie
    on ie.organization_id = l.organization_id
   and ie.connection_id = l.connection_id
   and ie.normalized_payload->>'phone' = l.phone
  where l.is_group = false
    and l.name is not null
    and coalesce(ie.normalized_payload->>'fromMe', 'false') = 'true'
    and nullif(trim(ie.normalized_payload->>'senderName'), '') = l.name
)
update public.leads l
  set name = (
        select nullif(trim(m.sender_name), '')
        from public.messages m
        join public.conversations c
          on c.organization_id = m.organization_id
         and c.id = m.conversation_id
        where c.organization_id = w.organization_id
          and c.lead_id = w.id
          and m.direction = 'INBOUND'
          and nullif(trim(m.sender_name), '') is not null
          and m.sender_name <> w.name
        order by m.created_at desc
        limit 1
      ),
      updated_at = now()
  from wrong w
  where l.id = w.id;

commit;

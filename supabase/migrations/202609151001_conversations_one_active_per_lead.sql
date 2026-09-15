begin;

-- findOrCreateConversation (packages/db/src/conversation-repository.ts) used to be a plain
-- check-then-insert with no locking: "is there an active conversation for this lead? no ->
-- insert one". Two webhook events arriving close together for the same lead (routine with
-- WhatsApp group chatter, or just fast back-to-back texting) both read "no active
-- conversation" before either commits its insert, so both create one. Confirmed in
-- production: the same lead ended up with 5+ active conversation rows within seconds of
-- each other.
--
-- Close every active conversation for a (org, connection, lead) except the most recently
-- created one so the unique index below can be created against existing data. Nothing is
-- deleted — the closed duplicates and their messages stay queryable, they just stop
-- competing to be "the" active conversation for that lead.
with ranked as (
  select id, row_number() over (
    partition by organization_id, connection_id, lead_id
    order by created_at desc
  ) as rn
  from public.conversations
  where stage not in ('CONVERTED', 'CLOSED')
)
update public.conversations c
set stage = 'CLOSED', updated_at = now()
from ranked
where c.id = ranked.id and ranked.rn > 1;

-- Enforces at most one active (non-CONVERTED/CLOSED) conversation per lead per connection.
-- findOrCreateConversation now relies on this: the loser of a concurrent insert race gets a
-- unique_violation (23505) and re-fetches the winner's row instead of creating a duplicate.
create unique index conversations_one_active_per_lead_idx
  on public.conversations(organization_id, connection_id, lead_id)
  where stage not in ('CONVERTED', 'CLOSED');

commit;

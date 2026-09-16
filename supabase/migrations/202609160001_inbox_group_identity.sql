begin;

-- A group is a conversation target; its participants are message authors. Keeping these
-- identities separate prevents the last participant's pushName from replacing the group title.
alter table public.leads
  add column if not exists is_group boolean not null default false,
  add column if not exists group_subject text;

alter table public.messages
  add column if not exists sender_name text,
  add column if not exists sender_jid text;

commit;

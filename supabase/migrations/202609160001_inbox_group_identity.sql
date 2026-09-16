begin;

-- A group is a conversation target; its participants are message authors. Keeping these
-- identities separate prevents the last participant's pushName from replacing the group title.
alter table public.leads
  add column if not exists is_group boolean not null default false,
  add column if not exists group_subject text;

alter table public.messages
  add column if not exists sender_name text,
  add column if not exists sender_jid text;

-- New overload preserves the original RPC for backwards-compatible integrations while new
-- inbox writes persist the per-message participant identity.
create function public.save_inbound_message(
  p_organization_id uuid,
  p_connection_id uuid,
  p_conversation_id uuid,
  p_direction text,
  p_sender text,
  p_content text,
  p_message_type text,
  p_provider_message_id text,
  p_sender_name text,
  p_sender_jid text
) returns table(id uuid, created_at timestamptz, is_new boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_created_at timestamptz;
begin
  insert into public.messages(
    organization_id, connection_id, conversation_id, direction, sender, content, message_type,
    provider_message_id, sender_name, sender_jid
  ) values (
    p_organization_id, p_connection_id, p_conversation_id, p_direction, p_sender, p_content,
    coalesce(p_message_type, 'text'), nullif(p_provider_message_id, ''),
    nullif(trim(coalesce(p_sender_name, '')), ''), nullif(trim(coalesce(p_sender_jid, '')), '')
  )
  on conflict (organization_id, connection_id, provider_message_id) do nothing
  returning messages.id, messages.created_at into v_id, v_created_at;

  if v_id is not null then
    update public.conversations c
      set last_message_at = greatest(coalesce(c.last_message_at, v_created_at), v_created_at),
          updated_at = greatest(c.updated_at, v_created_at)
      where c.id = p_conversation_id and c.organization_id = p_organization_id;
    return query select v_id, v_created_at, true;
    return;
  end if;

  select m.id, m.created_at into v_id, v_created_at
    from public.messages m
    where m.organization_id = p_organization_id and m.connection_id = p_connection_id
      and m.provider_message_id = nullif(p_provider_message_id, '')
    limit 1;
  return query select v_id, v_created_at, false;
end $$;

revoke all on function public.save_inbound_message(uuid,uuid,uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.save_inbound_message(uuid,uuid,uuid,text,text,text,text,text,text,text) to service_role;

commit;

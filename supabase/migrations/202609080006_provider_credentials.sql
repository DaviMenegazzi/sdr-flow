-- PostgREST exposes public RPCs, never the private credentials table.
create function public.set_connection_credentials(p_org uuid, p_connection uuid, p_ciphertext text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.connections where id = p_connection and organization_id = p_org) then
    raise exception 'Connection not found in organization';
  end if;
  insert into private.connection_credentials(connection_id, ciphertext) values(p_connection, p_ciphertext)
  on conflict (connection_id) do update set ciphertext = excluded.ciphertext;
end;
$$;
create function public.get_connection_credentials(p_connection uuid)
returns text language sql stable security definer set search_path = '' as $$
  select ciphertext from private.connection_credentials where connection_id = p_connection;
$$;
revoke all on function public.set_connection_credentials(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_connection_credentials(uuid) from public, anon, authenticated;
grant execute on function public.set_connection_credentials(uuid, uuid, text) to service_role;
grant execute on function public.get_connection_credentials(uuid) to service_role;

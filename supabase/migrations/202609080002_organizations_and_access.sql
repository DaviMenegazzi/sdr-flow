begin;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  email text not null check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  role public.member_role not null default 'viewer',
  token text not null unique check (length(token) >= 32),
  invited_by uuid references auth.users on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  key_hash text not null unique,
  key_prefix text not null check (length(key_prefix) between 4 and 16),
  role public.member_role not null default 'viewer',
  scopes text[] not null default array['flows:read'],
  created_by uuid references auth.users on delete set null,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;
alter table public.api_keys enable row level security;

create policy invitation_read on public.invitations for select to authenticated
  using (private.org_role(organization_id) is not null);
create policy invitation_write on public.invitations for all to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'))
  with check (private.org_role(organization_id) in ('owner', 'admin'));

create policy apikey_read on public.api_keys for select to authenticated
  using (private.org_role(organization_id) is not null);
create policy apikey_write on public.api_keys for all to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'))
  with check (private.org_role(organization_id) in ('owner', 'admin'));

create index invitations_org_idx on public.invitations (organization_id);
create index api_keys_org_idx on public.api_keys (organization_id);
create index api_keys_hash_idx on public.api_keys (key_hash);

grant select on public.invitations, public.api_keys to authenticated;
grant all on public.invitations, public.api_keys to service_role;

create function public.create_invitation(
  p_org uuid,
  p_email text,
  p_role public.member_role,
  p_token text
) returns public.invitations
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_invitation public.invitations;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = v_actor and role in ('owner', 'admin')
  ) then
    raise exception 'Permission denied to invite members' using errcode = '42501';
  end if;

  insert into public.invitations(organization_id, email, role, token, invited_by)
  values (p_org, lower(trim(p_email)), p_role, p_token, v_actor)
  returning * into v_invitation;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (p_org, v_actor, 'member.invited', v_invitation.id, jsonb_build_object('email', v_invitation.email, 'role', v_invitation.role));

  return v_invitation;
end $$;
revoke all on function public.create_invitation(uuid, text, public.member_role, text) from public;
grant execute on function public.create_invitation(uuid, text, public.member_role, text) to authenticated, service_role;

create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_invitation public.invitations;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_invitation from public.invitations
  where token = p_token and expires_at > now();

  if not found then
    raise exception 'Invalid or expired invitation token' using errcode = 'P0002';
  end if;

  insert into public.organization_members(organization_id, user_id, role)
  values (v_invitation.organization_id, v_actor, v_invitation.role)
  on conflict (organization_id, user_id)
  do update set role = excluded.role;

  delete from public.invitations where id = v_invitation.id;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
  values (v_invitation.organization_id, v_actor, 'member.joined_via_invitation', v_invitation.organization_id, jsonb_build_object('role', v_invitation.role));

  return v_invitation.organization_id;
end $$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated, service_role;

commit;

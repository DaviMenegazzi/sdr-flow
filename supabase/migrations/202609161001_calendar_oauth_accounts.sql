-- Migration: Calendar OAuth Accounts & Credentials Store
-- Supports multi-tenant Google Calendar connections per organization with strict RLS.

create table public.calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'google_calendar' check (provider in ('google_calendar')),
  account_email text not null,
  account_name text,
  status text not null default 'connected' check (status in ('connected', 'expired', 'revoked', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, provider, account_email)
);

alter table public.calendar_accounts enable row level security;
alter table public.calendar_accounts force row level security;

create policy calendar_accounts_org_select on public.calendar_accounts
  for select to authenticated
  using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())));

create policy calendar_accounts_org_write on public.calendar_accounts
  for all to authenticated
  using (exists (
    select 1 from public.organization_members
    where organization_id = calendar_accounts.organization_id
      and user_id = (select auth.uid())
      and role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.organization_members
    where organization_id = calendar_accounts.organization_id
      and user_id = (select auth.uid())
      and role in ('owner', 'admin')
  ));

grant select, insert, update, delete on public.calendar_accounts to authenticated;
grant all on public.calendar_accounts to service_role;

create table private.calendar_account_credentials (
  account_id uuid primary key references public.calendar_accounts(id) on delete cascade,
  ciphertext text not null
);

alter table private.calendar_account_credentials enable row level security;
alter table private.calendar_account_credentials force row level security;

create table private.oauth_states (
  state text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google_calendar',
  redirect_url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table private.oauth_states enable row level security;
alter table private.oauth_states force row level security;

-- Security definer functions for credentials & OAuth state management
create function public.set_calendar_credentials(p_org uuid, p_account uuid, p_ciphertext text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.calendar_accounts where id = p_account and organization_id = p_org) then
    raise exception 'Calendar account not found in organization';
  end if;
  insert into private.calendar_account_credentials(account_id, ciphertext) values(p_account, p_ciphertext)
  on conflict (account_id) do update set ciphertext = excluded.ciphertext;
end;
$$;

create function public.get_calendar_credentials(p_account uuid)
returns text language sql stable security definer set search_path = '' as $$
  select ciphertext from private.calendar_account_credentials where account_id = p_account;
$$;

create function public.create_oauth_state(p_org uuid, p_user uuid, p_state text, p_provider text, p_redirect_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from private.oauth_states where expires_at < now();
  insert into private.oauth_states(state, organization_id, user_id, provider, redirect_url, expires_at)
  values (p_state, p_org, p_user, coalesce(p_provider, 'google_calendar'), p_redirect_url, now() + interval '10 minutes');
end;
$$;

create function public.verify_and_consume_oauth_state(p_state text)
returns table(organization_id uuid, user_id uuid, provider text, redirect_url text)
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
begin
  delete from private.oauth_states where expires_at < now();
  select os.organization_id, os.user_id, os.provider, os.redirect_url
  into v_row
  from private.oauth_states os
  where os.state = p_state and os.expires_at > now();

  if not found then
    return;
  end if;

  delete from private.oauth_states where state = p_state;
  return query select v_row.organization_id, v_row.user_id, v_row.provider, v_row.redirect_url;
end;
$$;

revoke all on function public.set_calendar_credentials(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_calendar_credentials(uuid) from public, anon, authenticated;
revoke all on function public.create_oauth_state(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_and_consume_oauth_state(text) from public, anon, authenticated;

grant execute on function public.set_calendar_credentials(uuid, uuid, text) to service_role;
grant execute on function public.get_calendar_credentials(uuid) to service_role;
grant execute on function public.create_oauth_state(uuid, uuid, text, text, text) to service_role;
grant execute on function public.verify_and_consume_oauth_state(text) to service_role;

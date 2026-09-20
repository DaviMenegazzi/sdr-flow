begin;

-- GoTrue may persist app_metadata after the auth.users INSERT trigger has already
-- run. Keep the initial trigger, but also reconcile whenever provisioning metadata
-- arrives later. This is idempotent and repairs already affected accounts.
create or replace function private.apply_target_login_provisioning(
  p_user uuid,
  p_email text,
  p_user_metadata jsonb,
  p_app_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_org_text text := nullif(trim(coalesce(p_app_metadata ->> 'sdr_target_organization_id', '')), '');
  v_target_org uuid;
  v_previous_org uuid;
  v_member_role public.member_role;
  v_app_role public.app_role;
  v_org_tier public.org_tier;
  v_actor uuid;
  v_display_name text := nullif(trim(coalesce(p_user_metadata ->> 'display_name', '')), '');
begin
  if v_target_org_text is null then
    return;
  end if;

  begin
    v_target_org := v_target_org_text::uuid;
    v_member_role := coalesce(nullif(p_app_metadata ->> 'sdr_member_role', ''), 'viewer')::public.member_role;
    v_app_role := coalesce(nullif(p_app_metadata ->> 'sdr_app_role', ''), 'client')::public.app_role;
    v_org_tier := coalesce(nullif(p_app_metadata ->> 'sdr_org_tier', ''), 'pre-venda')::public.org_tier;
    v_actor := nullif(p_app_metadata ->> 'sdr_provisioned_by', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'Invalid login provisioning metadata' using errcode = '22023';
  end;

  if not exists (select 1 from public.organizations where id = v_target_org) then
    raise exception 'Target organization not found' using errcode = 'P0002';
  end if;

  select default_organization_id
  into v_previous_org
  from public.profiles
  where user_id = p_user;

  insert into public.organization_members(organization_id, user_id, role)
  values (v_target_org, p_user, v_member_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;

  insert into public.profiles(user_id, display_name, role, status, default_organization_id)
  values (p_user, v_display_name, v_app_role, 'active', v_target_org)
  on conflict (user_id) do update
    set display_name = coalesce(excluded.display_name, public.profiles.display_name),
        role = excluded.role,
        status = 'active',
        default_organization_id = excluded.default_organization_id,
        updated_at = now();

  update public.organizations
  set tier = v_org_tier
  where id = v_target_org;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_limits'
      and column_name = 'owner_user_id'
  ) then
    execute
      'insert into public.account_limits(organization_id, owner_user_id) values ($1, $2) on conflict do nothing'
      using v_target_org, p_user;
  else
    insert into public.account_limits(organization_id)
    values (v_target_org)
    on conflict (organization_id) do nothing;
  end if;

  if not exists (
    select 1
    from public.audit_events
    where organization_id = v_target_org
      and action = 'account.login_created'
      and entity_id = p_user
  ) then
    insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
    values (
      v_target_org,
      v_actor,
      'account.login_created',
      p_user,
      jsonb_build_object(
        'email', lower(p_email),
        'app_role', v_app_role,
        'member_role', v_member_role,
        'org_tier', v_org_tier
      )
    );
  end if;

  -- The fallback INSERT trigger may have created a private organization before
  -- app_metadata arrived. Remove only this user's sole owner membership; keep the
  -- organization and its data intact for a later, explicit cleanup.
  if v_previous_org is not null and v_previous_org <> v_target_org then
    delete from public.organization_members membership
    where membership.organization_id = v_previous_org
      and membership.user_id = p_user
      and membership.role = 'owner'
      and (
        select count(*)
        from public.organization_members sibling
        where sibling.organization_id = v_previous_org
      ) = 1;
  end if;
end
$$;

revoke all on function private.apply_target_login_provisioning(uuid, text, jsonb, jsonb) from public;

create or replace function private.provision_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_agent uuid;
  v_target_org text := nullif(trim(coalesce(new.raw_app_meta_data ->> 'sdr_target_organization_id', '')), '');
begin
  if v_target_org is not null then
    perform private.apply_target_login_provisioning(new.id, new.email, new.raw_user_meta_data, new.raw_app_meta_data);
    return new;
  end if;

  insert into public.organizations(name)
  values (coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Minha conta'))
  returning id into v_org;

  insert into public.organization_members(organization_id, user_id, role)
  values (v_org, new.id, 'owner');

  insert into public.profiles(user_id, display_name, role, status, default_organization_id)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'client', 'active', v_org);

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_limits'
      and column_name = 'owner_user_id'
  ) then
    execute
      'insert into public.account_limits(organization_id, owner_user_id) values ($1, $2) on conflict do nothing'
      using v_org, new.id;
  else
    insert into public.account_limits(organization_id)
    values (v_org)
    on conflict (organization_id) do nothing;
  end if;

  insert into public.ai_agents(
    organization_id,
    owner_user_id,
    name,
    provider,
    model,
    system_prompt,
    is_default
  )
  values (v_org, new.id, 'Agente padrão', 'openai', 'gpt-4.1-mini', '', true)
  returning id into v_agent;

  return new;
end
$$;

create or replace function private.reconcile_login_provisioning_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_target_login_provisioning(new.id, new.email, new.raw_user_meta_data, new.raw_app_meta_data);
  return new;
end
$$;

revoke all on function private.reconcile_login_provisioning_metadata() from public;

drop trigger if exists on_auth_user_provisioning_metadata_updated on auth.users;
create trigger on_auth_user_provisioning_metadata_updated
after update of raw_app_meta_data on auth.users
for each row
when (
  nullif(trim(coalesce(old.raw_app_meta_data ->> 'sdr_target_organization_id', '')), '') is distinct from
  nullif(trim(coalesce(new.raw_app_meta_data ->> 'sdr_target_organization_id', '')), '')
  and nullif(trim(coalesce(new.raw_app_meta_data ->> 'sdr_target_organization_id', '')), '') is not null
)
execute function private.reconcile_login_provisioning_metadata();

-- Repair users (including the affected Joao login) whose trusted provisioning
-- metadata already points at an organization but whose profile still points at
-- the fallback personal organization.
do $$
declare
  provisioned_user record;
begin
  for provisioned_user in
    select id, email, raw_user_meta_data, raw_app_meta_data
    from auth.users
    where nullif(trim(coalesce(raw_app_meta_data ->> 'sdr_target_organization_id', '')), '') is not null
  loop
    perform private.apply_target_login_provisioning(
      provisioned_user.id,
      provisioned_user.email,
      provisioned_user.raw_user_meta_data,
      provisioned_user.raw_app_meta_data
    );
  end loop;
end
$$;

commit;

begin;

-- Production originally stored limits once per organization, while newer
-- installations store them per organization member. Keep user provisioning
-- compatible with both layouts so an Auth trigger failure cannot block login
-- creation during the schema transition.
create or replace function private.provision_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_target_org text := nullif(trim(coalesce(new.raw_app_meta_data ->> 'sdr_target_organization_id', '')), '');
  v_member_role public.member_role := 'owner';
  v_app_role public.app_role := 'client';
  v_org_tier public.org_tier := 'pre-venda';
  v_actor uuid;
begin
  if v_target_org is null then
    insert into public.organizations(name)
    values (coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Minha conta'))
    returning id into v_org;
  else
    begin
      v_org := v_target_org::uuid;
      v_member_role := coalesce(
        nullif(new.raw_app_meta_data ->> 'sdr_member_role', '')::public.member_role,
        'viewer'::public.member_role
      );
      v_app_role := coalesce(
        nullif(new.raw_app_meta_data ->> 'sdr_app_role', '')::public.app_role,
        'client'::public.app_role
      );
      v_org_tier := coalesce(
        nullif(new.raw_app_meta_data ->> 'sdr_org_tier', '')::public.org_tier,
        'pre-venda'::public.org_tier
      );
      v_actor := nullif(new.raw_app_meta_data ->> 'sdr_provisioned_by', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Invalid account provisioning metadata' using errcode = '22023';
    end;

    if not exists (select 1 from public.organizations where id = v_org) then
      raise exception 'Target organization not found' using errcode = 'P0002';
    end if;

    update public.organizations
    set tier = v_org_tier
    where id = v_org;
  end if;

  insert into public.organization_members(organization_id, user_id, role)
  values (v_org, new.id, v_member_role);

  insert into public.profiles(user_id, display_name, role, status, default_organization_id)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    v_app_role,
    'active',
    v_org
  );

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
  values (v_org, new.id, 'Agente padrão', 'openai', 'gpt-4.1-mini', '', true);

  if v_target_org is not null then
    insert into public.audit_events(organization_id, actor_id, action, entity_id, details)
    values (
      v_org,
      v_actor,
      'account.login_created',
      new.id,
      jsonb_build_object(
        'email', lower(new.email),
        'app_role', v_app_role,
        'member_role', v_member_role,
        'org_tier', v_org_tier
      )
    );
  end if;

  return new;
end $$;

commit;

begin;

-- The checkout asks for the company name: it names the new organization. Accounts created
-- without it keep the previous fallback (the person's name, then 'Minha conta').
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
  values (coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'company_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    'Minha conta'
  ))
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

commit;

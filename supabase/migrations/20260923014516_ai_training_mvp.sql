begin;

-- The knowledge search RPC accepts an organization argument. Run it as the caller
-- so knowledge_documents RLS remains authoritative for direct RPC access.
alter function public.match_knowledge(uuid, float4[], text, float4, integer) security invoker;

create table public.organization_training_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company jsonb not null default '{}'::jsonb check (jsonb_typeof(company) = 'object'),
  sales jsonb not null default '{}'::jsonb check (jsonb_typeof(sales) = 'object'),
  revision integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id),
  unique (organization_id, id)
);

create table public.training_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  category text not null check (category in ('pricing', 'catalog', 'faq', 'objections', 'documents')),
  question text not null,
  answer text not null,
  source_type text not null default 'interview' check (source_type in ('interview', 'manual')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  revision integer not null default 1,
  knowledge_document_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, profile_id) references public.organization_training_profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, knowledge_document_id) references public.knowledge_documents(organization_id, id)
);
create index training_facts_org_status_idx on public.training_facts(organization_id, status, category);

alter table public.organization_training_profiles enable row level security;
alter table public.training_facts enable row level security;

create policy training_profiles_read on public.organization_training_profiles for select to authenticated
  using (private.org_role(organization_id) is not null);
create policy training_profiles_insert on public.organization_training_profiles for insert to authenticated
  with check (private.org_role(organization_id) in ('owner', 'admin'));
create policy training_profiles_update on public.organization_training_profiles for update to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'))
  with check (private.org_role(organization_id) in ('owner', 'admin'));
create policy training_facts_read on public.training_facts for select to authenticated
  using (private.org_role(organization_id) is not null);
create policy training_facts_insert on public.training_facts for insert to authenticated
  with check (private.org_role(organization_id) in ('owner', 'admin'));
create policy training_facts_update on public.training_facts for update to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'))
  with check (private.org_role(organization_id) in ('owner', 'admin'));

grant select, insert, update on public.organization_training_profiles, public.training_facts to authenticated;
grant all on public.organization_training_profiles, public.training_facts to service_role;

create function public.approve_training_fact(p_org uuid, p_fact uuid, p_embedding float4[])
returns public.training_facts
language plpgsql security definer set search_path = '' as $$
declare v_fact public.training_facts; v_doc uuid;
begin
  if auth.uid() is null or not coalesce(private.org_role(p_org) in ('owner', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_fact from public.training_facts where organization_id = p_org and id = p_fact for update;
  if not found or v_fact.status = 'archived' then raise exception 'Fact not found' using errcode = 'P0002'; end if;
  if v_fact.knowledge_document_id is null then
    insert into public.knowledge_documents(organization_id, collection, title, content, metadata, embedding, token_count)
    values (p_org, v_fact.category, v_fact.question, v_fact.answer,
      jsonb_build_object('training_fact_id', v_fact.id, 'revision', v_fact.revision, 'source_type', v_fact.source_type),
      p_embedding, greatest(1, ceil(length(v_fact.answer)::numeric / 4)::integer)) returning id into v_doc;
  else
    update public.knowledge_documents set collection = v_fact.category, title = v_fact.question, content = v_fact.answer,
      metadata = jsonb_build_object('training_fact_id', v_fact.id, 'revision', v_fact.revision, 'source_type', v_fact.source_type),
      embedding = p_embedding, token_count = greatest(1, ceil(length(v_fact.answer)::numeric / 4)::integer), updated_at = now()
      where organization_id = p_org and id = v_fact.knowledge_document_id returning id into v_doc;
  end if;
  update public.training_facts set status = 'approved', knowledge_document_id = v_doc,
    approved_by = auth.uid(), approved_at = now(), updated_at = now()
    where organization_id = p_org and id = p_fact returning * into v_fact;
  return v_fact;
end $$;

create function public.archive_training_fact(p_org uuid, p_fact uuid)
returns public.training_facts
language plpgsql security definer set search_path = '' as $$
declare v_fact public.training_facts;
begin
  if auth.uid() is null or not coalesce(private.org_role(p_org) in ('owner', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_fact from public.training_facts where organization_id = p_org and id = p_fact for update;
  if not found then raise exception 'Fact not found' using errcode = 'P0002'; end if;
  if v_fact.knowledge_document_id is not null then
    update public.training_facts set knowledge_document_id = null where organization_id = p_org and id = p_fact;
    delete from public.knowledge_documents where organization_id = p_org and id = v_fact.knowledge_document_id;
  end if;
  update public.training_facts set status = 'archived', knowledge_document_id = null, updated_at = now()
    where organization_id = p_org and id = p_fact returning * into v_fact;
  return v_fact;
end $$;

create function public.revise_training_fact(p_org uuid, p_fact uuid, p_category text, p_question text, p_answer text)
returns public.training_facts
language plpgsql security definer set search_path = '' as $$
declare v_fact public.training_facts;
begin
  if auth.uid() is null or not coalesce(private.org_role(p_org) in ('owner', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_category not in ('pricing', 'catalog', 'faq', 'objections', 'documents')
     or length(trim(p_question)) = 0 or length(trim(p_answer)) = 0 then
    raise exception 'Invalid fact' using errcode = '22023';
  end if;
  select * into v_fact from public.training_facts where organization_id = p_org and id = p_fact for update;
  if not found or v_fact.status = 'archived' then raise exception 'Fact not found' using errcode = 'P0002'; end if;
  if v_fact.knowledge_document_id is not null then
    update public.training_facts set knowledge_document_id = null where organization_id = p_org and id = p_fact;
    delete from public.knowledge_documents where organization_id = p_org and id = v_fact.knowledge_document_id;
  end if;
  update public.training_facts set category = p_category, question = trim(p_question), answer = trim(p_answer),
    status = 'draft', revision = revision + 1, knowledge_document_id = null,
    approved_by = null, approved_at = null, updated_at = now()
    where organization_id = p_org and id = p_fact returning * into v_fact;
  return v_fact;
end $$;

create function public.approve_training_profile(p_org uuid)
returns public.organization_training_profiles
language plpgsql security definer set search_path = '' as $$
declare v_profile public.organization_training_profiles;
begin
  if auth.uid() is null or not coalesce(private.org_role(p_org) in ('owner', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.organization_training_profiles set status = 'approved', approved_by = auth.uid(),
    approved_at = now(), updated_at = now() where organization_id = p_org returning * into v_profile;
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  return v_profile;
end $$;

revoke all on function public.approve_training_fact(uuid, uuid, float4[]) from public, anon;
revoke all on function public.archive_training_fact(uuid, uuid) from public, anon;
revoke all on function public.revise_training_fact(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.approve_training_profile(uuid) from public, anon;
grant execute on function public.approve_training_fact(uuid, uuid, float4[]) to authenticated;
grant execute on function public.archive_training_fact(uuid, uuid) to authenticated;
grant execute on function public.revise_training_fact(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.approve_training_profile(uuid) to authenticated;

commit;

begin;

-- Safe pgvector extension handling:
-- If pgvector is available in Postgres/Supabase, enable it.
-- If running in embedded/test Postgres (PGlite) where compiled C extensions are absent, create domain.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    execute 'create extension if not exists vector';
  else
    if not exists (select 1 from pg_type where typname = 'vector') then
      execute 'create domain public.vector as float4[]';
    end if;
  end if;
end $$;

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  collection text not null default 'default',
  title text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  embedding float4[],
  token_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index if not exists knowledge_documents_org_coll_idx
  on public.knowledge_documents(organization_id, collection);

create table if not exists public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  summary text not null,
  last_message_id uuid references public.messages(id) on delete set null,
  messages_count integer not null default 0,
  tokens_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, conversation_id)
);

create index if not exists conversation_summaries_org_conv_idx
  on public.conversation_summaries(organization_id, conversation_id);

-- Cosine similarity helper for float4[]
create or replace function public.cosine_similarity(a float4[], b float4[])
returns float4
language plpgsql
immutable
as $$
declare
  dot float4 := 0;
  norm_a float4 := 0;
  norm_b float4 := 0;
  i int;
  len int;
begin
  if a is null or b is null then
    return 0;
  end if;
  len := cardinality(a);
  if len = 0 or len <> cardinality(b) then
    return 0;
  end if;
  for i in 1..len loop
    dot := dot + (a[i] * b[i]);
    norm_a := norm_a + (a[i] * a[i]);
    norm_b := norm_b + (b[i] * b[i]);
  end loop;
  if norm_a = 0 or norm_b = 0 then
    return 0;
  end if;
  return dot / (sqrt(norm_a) * sqrt(norm_b));
end;
$$;

-- Semantic match function
create or replace function public.match_knowledge(
  p_org uuid,
  p_embedding float4[],
  p_collection text default null,
  p_threshold float4 default 0.5,
  p_limit int default 5
)
returns table (
  id uuid,
  collection text,
  title text,
  content text,
  metadata jsonb,
  similarity float4
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    kd.id,
    kd.collection,
    kd.title,
    kd.content,
    kd.metadata,
    public.cosine_similarity(kd.embedding, p_embedding) as similarity
  from public.knowledge_documents kd
  where kd.organization_id = p_org
    and (p_collection is null or kd.collection = p_collection)
    and kd.embedding is not null
    and public.cosine_similarity(kd.embedding, p_embedding) >= p_threshold
  order by similarity desc
  limit p_limit;
$$;

-- RLS
alter table public.knowledge_documents enable row level security;
alter table public.conversation_summaries enable row level security;

-- knowledge_documents policies
create policy knowledge_documents_select on public.knowledge_documents
  for select to authenticated
  using (private.org_role(organization_id) is not null);

create policy knowledge_documents_insert on public.knowledge_documents
  for insert to authenticated
  with check (private.org_role(organization_id) in ('owner', 'admin'));

create policy knowledge_documents_update on public.knowledge_documents
  for update to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'))
  with check (private.org_role(organization_id) in ('owner', 'admin'));

create policy knowledge_documents_delete on public.knowledge_documents
  for delete to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'));

-- conversation_summaries policies
create policy conversation_summaries_select on public.conversation_summaries
  for select to authenticated
  using (private.org_role(organization_id) is not null);

create policy conversation_summaries_insert on public.conversation_summaries
  for insert to authenticated
  with check (private.org_role(organization_id) is not null);

create policy conversation_summaries_update on public.conversation_summaries
  for update to authenticated
  using (private.org_role(organization_id) is not null)
  with check (private.org_role(organization_id) is not null);

create policy conversation_summaries_delete on public.conversation_summaries
  for delete to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'));

-- Grants
grant select, insert, update, delete on public.knowledge_documents to authenticated, service_role;
grant select, insert, update, delete on public.conversation_summaries to authenticated, service_role;
grant execute on function public.cosine_similarity(float4[], float4[]) to authenticated, service_role;
grant execute on function public.match_knowledge(uuid, float4[], text, float4, int) to authenticated, service_role;

commit;

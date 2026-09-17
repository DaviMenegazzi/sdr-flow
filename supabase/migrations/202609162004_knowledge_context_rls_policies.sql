-- knowledge_documents and conversation_summaries both have row level security enabled
-- (202609080004_knowledge_and_context.sql) but zero policies exist on either in this
-- database — confirmed via pg_policy, not just absent from the migration's own history. RLS
-- enabled with no policies denies every operation to non-service-role callers regardless of
-- their actual organization role, which is exactly what surfaced as "new row violates row-level
-- security policy for table knowledge_documents" on a normal owner's insert. Re-creating the
-- original policies verbatim; "create policy" has no "if not exists" form, so this is
-- idempotent via a guard instead.
do $$
begin
  if not exists (select 1 from pg_policy where polname = 'knowledge_documents_select' and polrelid = 'public.knowledge_documents'::regclass) then
    create policy knowledge_documents_select on public.knowledge_documents
      for select to authenticated
      using (private.org_role(organization_id) is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'knowledge_documents_insert' and polrelid = 'public.knowledge_documents'::regclass) then
    create policy knowledge_documents_insert on public.knowledge_documents
      for insert to authenticated
      with check (private.org_role(organization_id) in ('owner', 'admin'));
  end if;

  if not exists (select 1 from pg_policy where polname = 'knowledge_documents_update' and polrelid = 'public.knowledge_documents'::regclass) then
    create policy knowledge_documents_update on public.knowledge_documents
      for update to authenticated
      using (private.org_role(organization_id) in ('owner', 'admin'))
      with check (private.org_role(organization_id) in ('owner', 'admin'));
  end if;

  if not exists (select 1 from pg_policy where polname = 'knowledge_documents_delete' and polrelid = 'public.knowledge_documents'::regclass) then
    create policy knowledge_documents_delete on public.knowledge_documents
      for delete to authenticated
      using (private.org_role(organization_id) in ('owner', 'admin'));
  end if;

  if not exists (select 1 from pg_policy where polname = 'conversation_summaries_select' and polrelid = 'public.conversation_summaries'::regclass) then
    create policy conversation_summaries_select on public.conversation_summaries
      for select to authenticated
      using (private.org_role(organization_id) is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'conversation_summaries_insert' and polrelid = 'public.conversation_summaries'::regclass) then
    create policy conversation_summaries_insert on public.conversation_summaries
      for insert to authenticated
      with check (private.org_role(organization_id) is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'conversation_summaries_update' and polrelid = 'public.conversation_summaries'::regclass) then
    create policy conversation_summaries_update on public.conversation_summaries
      for update to authenticated
      using (private.org_role(organization_id) is not null)
      with check (private.org_role(organization_id) is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'conversation_summaries_delete' and polrelid = 'public.conversation_summaries'::regclass) then
    create policy conversation_summaries_delete on public.conversation_summaries
      for delete to authenticated
      using (private.org_role(organization_id) in ('owner', 'admin'));
  end if;
end $$;

grant select, insert, update, delete on public.knowledge_documents to authenticated, service_role;
grant select, insert, update, delete on public.conversation_summaries to authenticated, service_role;

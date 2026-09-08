begin;

-- Add updated_at column to connections if not present
alter table public.connections add column if not exists updated_at timestamptz not null default now();

-- Policies for connections table for owners and admins
create policy connection_insert on public.connections for insert to authenticated
  with check (private.org_role(organization_id) in ('owner', 'admin'));

create policy connection_update on public.connections for update to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'))
  with check (private.org_role(organization_id) in ('owner', 'admin'));

create policy connection_delete on public.connections for delete to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'));

grant insert, update, delete on public.connections to authenticated;

commit;

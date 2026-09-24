begin;

-- Supabase default privileges may grant new public-schema functions to anon.
-- These SECURITY DEFINER functions rely on the authenticated session and must
-- not be callable through PostgREST without one.
revoke all on function public.admin_grant_org_plan(uuid, public.org_tier, text, timestamptz) from anon;
revoke all on function public.admin_revoke_org_plan(uuid, text) from anon;
revoke all on function public.get_organization_limits(uuid) from anon;

commit;

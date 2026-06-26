-- Harden the API surface: revoke EXECUTE on SECURITY DEFINER helper functions
-- that are NOT used by any RLS policy, view, or other function, and that the
-- application never calls via PostgREST RPC. Leaving them with the default
-- PUBLIC EXECUTE grant exposes them at /rest/v1/rpc/<fn> to the anon and
-- authenticated roles (Supabase linter 0028/0029).
--
-- Functions that ARE referenced by RLS policies (has_gym_role, is_gym_staff,
-- is_platform_admin) are deliberately left callable: Postgres enforces EXECUTE
-- on functions invoked inside policy expressions, so revoking it would break
-- row-level security for signed-in users. Their RPC exposure is inherent to the
-- RLS-helper pattern and is expected.
--
-- Each of the functions below was verified to have zero references in
-- pg_policies, pg_views, and other function bodies, and the codebase contains no
-- supabase.rpc() calls — so revoking EXECUTE has no functional impact.

revoke execute on function public.get_current_gym_id() from public, anon, authenticated;
revoke execute on function public.get_my_profile_id() from public, anon, authenticated;
revoke execute on function public.get_user_gyms() from public, anon, authenticated;
revoke execute on function public.gym_id_from_waiver(uuid) from public, anon, authenticated;
revoke execute on function public.is_gym_member(uuid) from public, anon, authenticated;
revoke execute on function public.is_gym_owner(uuid) from public, anon, authenticated;

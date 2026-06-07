-- S10: Revoke anon EXECUTE on the SECURITY DEFINER helper functions flagged
-- by Supabase advisor lint 0028 (anon_security_definer_function_executable).
-- These return booleans about the CURRENT caller; an unauthenticated caller
-- always returns false/empty, so there's no legitimate reason for anon to
-- invoke them via /rest/v1/rpc/<name>.
--
-- `authenticated` keeps EXECUTE — RLS policies on most tables call into
-- these helpers (e.g. is_platform_admin(), is_gym_owner(_gym_id)) and the
-- policies run as the calling role.

REVOKE EXECUTE ON FUNCTION public.get_current_gym_id()                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_id()                               FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_gyms()                                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.gym_id_from_waiver(uuid)                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_gym_role(uuid, public.user_role[])            FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_gym_member(uuid)                               FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_gym_owner(uuid)                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_gym_staff(uuid)                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin()                               FROM anon;

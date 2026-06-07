-- S2: Stop trigger-only SECURITY DEFINER functions from being callable
-- through PostgREST as /rest/v1/rpc/<name> by anon or authenticated clients.
-- These are wired to triggers (handle_new_user, log_payment_change,
-- sync_*_to_*) or are admin/cron-only utilities (expire_subscriptions,
-- rls_auto_enable). The privilege-escalation risk: anon callers could
-- execute them with the function-owner's (typically postgres) permissions
-- and bypass RLS.
--
-- We keep the helper auth fns (is_platform_admin, is_gym_owner, etc.)
-- callable — RLS policies depend on them and they only return booleans
-- about the CURRENT caller.

REVOKE EXECUTE ON FUNCTION public.handle_new_user()             FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.expire_subscriptions()        FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.log_payment_change()          FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sync_memberships_to_subs()    FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sync_subs_to_memberships()    FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()             FROM anon, authenticated, public;

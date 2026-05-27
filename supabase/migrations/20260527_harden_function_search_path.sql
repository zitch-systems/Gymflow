-- Security hardening — close the "function_search_path_mutable" advisory.
--
-- A function without a fixed search_path can be hijacked if an attacker can
-- create an object in a schema that precedes the intended one on the path.
-- Pinning search_path removes that vector. We include `public` (app tables),
-- `extensions` (Supabase-managed extension functions, e.g. gen_random_uuid),
-- and `pg_temp`, which is what these helpers actually reference — so behaviour
-- is unchanged, only the path is locked.
--
-- Apply via the Supabase SQL editor, `supabase db push`, or MCP apply_migration.
-- AFTER applying, smoke-test: gym landing (public read), member login, and an
-- admin page — several SECURITY DEFINER helpers (has_gym_role, get_current_gym_id,
-- is_platform_admin, …) are used inside RLS policies.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, extensions, pg_temp',
      r.name, r.args
    );
  END LOOP;
END $$;

-- Remaining advisories to address in the Supabase dashboard (not pure SQL):
--   • Auth → Providers → Email: enable "Leaked password protection".
--   • Review the public.pricing_plans SECURITY DEFINER view (recreate as
--     security_invoker if it doesn't need elevated rights).

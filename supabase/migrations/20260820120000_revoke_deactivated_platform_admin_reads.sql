-- Security fix: a DEACTIVATED platform admin (platform_admins.is_active = false)
-- still had cross-tenant SELECT on two tables, because two policy predicates
-- test raw membership in platform_admins instead of the is_active-gated helper
-- private.is_platform_admin(). Deactivating a platform_admins row is the only
-- revocation the product offers — requirePlatformAdmin() honours it and locks
-- the person out of /superadmin — but PostgREST with the public anon key does
-- not go through app code, so these two policies leaked to an offboarded
-- operator whose auth account still exists.
--
-- Every other platform-admin predicate in the schema was already normalised to
-- private.is_platform_admin() (which carries `coalesce(is_active, true) = true`
-- for both the profiles.role='platform_admin' and the platform_admins paths);
-- these two were missed. This migration brings them in line. No widening: a
-- LIVE platform admin still sees exactly what they did before.

-- 1) public.profiles — the whole PII surface (names, emails, phones, DOB,
--    addresses, emergency contacts, health notes) for every member and staffer
--    of every gym. can_see_profile()'s last clause used the raw EXISTS.
--    Re-issue byte-identical except that clause, so the 20260717 fix
--    (a suspended colleague stays visible to their own gym's managers) is
--    preserved unchanged.
create or replace function public.can_see_profile(target_user_id uuid)
  returns boolean
  language sql
  stable
  set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  SELECT
    target_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.gym_staff_links me
      JOIN public.gym_member_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid()
        AND me.is_active = true
        AND them.user_id = target_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.gym_staff_links me
      JOIN public.gym_staff_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid()
        AND me.is_active = true
        AND them.user_id = target_user_id
    )
    OR private.is_platform_admin();
$function$;

-- 2) public.platform_payments — every gym's GymFlow subscription billing
--    history (amount, plan, period, paystack_reference), i.e. the platform's
--    own revenue book. The gym-owner branch already requires is_active; only
--    the platform-admin branch was ungated. Recreate matching how
--    payments_select_scoped is written.
drop policy if exists pp_select_gym_or_admin on public.platform_payments;
create policy pp_select_gym_or_admin on public.platform_payments
  as permissive for select to authenticated
  using (
    (exists (
      select 1
      from public.gym_staff_links s
      where s.gym_id = platform_payments.gym_id
        and s.user_id = (select auth.uid())
        and s.role = 'gym_owner'::user_role
        and s.is_active = true
    ))
    or private.is_platform_admin()
  );

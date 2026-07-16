-- RBAC access-view hardening. Four DB-layer mismatches surfaced by an audit of
-- nav vs page-gate vs server-action-gate vs RLS across every surface. Each fix
-- brings the DB authority (RLS / SECURITY DEFINER function) back in line with
-- what the app already assumes. All idempotent (drop/create, create or replace).
--
-- The baseline schema (00000000000000_baseline_schema.sql) is a squashed dump;
-- these live here as a normal dated migration rather than editing it in place.

-- 1) payments SELECT was readable by ANY active staff link, including instructors.
--    The staff branch had no role filter, so an instructor (who holds an active
--    gym_staff_links row) could read every member's payment record — money +
--    member PII the admin console deliberately walls coaches off from, and which
--    the sibling INSERT policy (payments_insert_staff) already role-scopes.
--    Match the INSERT policy: restrict the staff branch to the four admin roles.
drop policy if exists payments_select_scoped on public.payments;
create policy payments_select_scoped on public.payments as PERMISSIVE for SELECT to authenticated
  using (
    (member_id = ( SELECT auth.uid() AS uid))
    OR has_gym_role(gym_id, ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role])
    OR is_platform_admin()
  );

-- 2) is_platform_admin() — the DB authority behind RLS on payments, memberships,
--    member links (PII), check-ins, equipment, audit logs, support tickets —
--    ignored platform_admins.is_active. Both app gates (requirePlatformAdmin /
--    isPlatformAdmin) require is_active = true, so deactivating a platform admin
--    locks them out of the console yet left their row satisfying this function:
--    RLS kept granting cross-tenant reads on their still-valid session. The
--    profiles branch already checks is_active; the platform_admins branch didn't.
create or replace function public.is_platform_admin()
  returns boolean
  language sql
  stable security definer
  set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles
             WHERE id = auth.uid()
               AND role = 'platform_admin'
               AND COALESCE(is_active, true) = true)
    OR EXISTS (SELECT 1 FROM public.platform_admins
                WHERE user_id = auth.uid()
                  AND COALESCE(is_active, true) = true);
$function$;

-- 3) notifications SELECT admitted only gym_owner/manager, but the INSERT policy
--    (and PR #127) admit front_desk/accountant to send reminders. The 3-day
--    de-dup guard in reminders.ts runs a SELECT through the RLS client; for a
--    front_desk/accountant actor it returned zero rows, so the cooldown never
--    fired and every click re-sent duplicate "expiring soon" notifications to
--    members. Align the SELECT role array with the INSERT policy's four roles.
drop policy if exists notif_select_self_or_gym on public.notifications;
create policy notif_select_self_or_gym on public.notifications as PERMISSIVE for SELECT to authenticated
  using (
    (user_id = ( SELECT auth.uid() AS uid))
    OR (EXISTS ( SELECT 1
       FROM gym_staff_links s
      WHERE ((s.gym_id = notifications.gym_id)
        AND (s.user_id = ( SELECT auth.uid() AS uid))
        AND (s.role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]))
        AND (s.is_active = true))))
  );

-- 4) gyms INSERT allowed ANY authenticated user to create gym rows (with check
--    auth.role() = 'authenticated'), bypassing the platform-admin-gated
--    onboarding flow and its uniqueness/owner-linkage logic — a spam / data-
--    integrity vector. Real provisioning (provisionOwner / provisionGym) writes
--    via the service-role client, which bypasses RLS, so restricting this policy
--    to platform admins does not affect signup or onboarding.
drop policy if exists gyms_insert on public.gyms;
create policy gyms_insert on public.gyms as PERMISSIVE for INSERT to public
  with check (is_platform_admin());

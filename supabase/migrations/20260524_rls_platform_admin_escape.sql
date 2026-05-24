-- Fix is_platform_admin() and add platform-admin escape hatches to the
-- gym-scoped RLS policies so a platform admin's user-scoped queries
-- return cross-gym data (the spec says "platform admins see and do
-- everything").
--
-- The existing is_platform_admin() function checks profiles.user_id =
-- auth.uid() — but profiles.id is the user-id column, not profiles.user_id.
-- So it always returned false in practice. Fix it to use id and also
-- accept membership in the platform_admins table as a fallback (matches
-- the TypeScript isPlatformAdmin() helper).

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles
             WHERE id = auth.uid()
               AND role = 'platform_admin'
               AND COALESCE(is_active, true) = true)
    OR EXISTS (SELECT 1 FROM public.platform_admins
                WHERE user_id = auth.uid());
$$;

-- ─── gym_member_links — add platform_admin escape ──────────────────────
DROP POLICY IF EXISTS gml_select ON public.gym_member_links;
CREATE POLICY gml_select ON public.gym_member_links
  FOR SELECT
  TO public
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.gym_staff_links s WHERE s.user_id = auth.uid() AND s.gym_id = gym_member_links.gym_id)
    OR public.is_platform_admin()
  );

-- ─── memberships — add platform_admin escape ───────────────────────────
DROP POLICY IF EXISTS memberships_select_scoped ON public.memberships;
CREATE POLICY memberships_select_scoped ON public.memberships
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.gym_staff_links s WHERE s.gym_id = memberships.gym_id AND s.user_id = auth.uid() AND s.is_active = true)
    OR public.is_platform_admin()
  );

-- ─── payments ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS payments_select_scoped ON public.payments;
CREATE POLICY payments_select_scoped ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.gym_staff_links s WHERE s.gym_id = payments.gym_id AND s.user_id = auth.uid() AND s.is_active = true)
    OR public.is_platform_admin()
  );

-- ─── equipment ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS equipment_select_staff ON public.equipment;
CREATE POLICY equipment_select_staff ON public.equipment
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.gym_staff_links s WHERE s.gym_id = equipment.gym_id AND s.user_id = auth.uid() AND s.is_active = true)
    OR public.is_platform_admin()
  );

-- ─── check_ins ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS checkins_select_scoped ON public.check_ins;
CREATE POLICY checkins_select_scoped ON public.check_ins
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.gym_staff_links s WHERE s.gym_id = check_ins.gym_id AND s.user_id = auth.uid() AND s.is_active = true)
    OR public.is_platform_admin()
  );

-- ─── audit_logs — platform admin sees everything ──────────────────────
-- (existing audit_logs_select_gym_owner only lets gym_owners see their gym's logs)
DROP POLICY IF EXISTS audit_logs_select_platform_admin ON public.audit_logs;
CREATE POLICY audit_logs_select_platform_admin ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- ─── platform_payments — already has platform_admin escape, no change ─

-- ─── notifications, member_subscriptions, instructor_* — already exist with
--      either is_platform_admin escape via can_see_profile or are read by
--      gym-scoped staff via existing policies; superadmin doesn't need
--      cross-gym reads on these right now.

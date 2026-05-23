-- Tighten profiles_select — currently qual:true (PII leak: next of kin,
-- health notes, contact info visible to any authenticated user).
--
-- Design: a helper `can_see_profile(target_uid)` returns true when:
--   - target is the caller (self-read)
--   - target is a member of a gym where the caller is an active staff/instructor
--   - target is staff at a gym where the caller is also active staff
--   - caller is a platform_admin
--
-- The helper is STABLE LANGUAGE SQL with no SECURITY DEFINER, so its
-- inner SELECTs against gym_staff_links/gym_member_links/platform_admins
-- still respect those tables' own RLS — no privilege escalation.

CREATE OR REPLACE FUNCTION public.can_see_profile(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    target_user_id = auth.uid()
    OR EXISTS (
      -- target is a member at a gym where I'm active staff/instructor
      SELECT 1
      FROM public.gym_staff_links me
      JOIN public.gym_member_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid()
        AND me.is_active = true
        AND them.user_id = target_user_id
    )
    OR EXISTS (
      -- target is active staff at a gym where I'm also active staff
      SELECT 1
      FROM public.gym_staff_links me
      JOIN public.gym_staff_links them ON me.gym_id = them.gym_id
      WHERE me.user_id = auth.uid()
        AND me.is_active = true
        AND them.user_id = target_user_id
        AND them.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
    );
$$;

DROP POLICY IF EXISTS profiles_select ON public.profiles;

CREATE POLICY profiles_select_scoped
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.can_see_profile(id));

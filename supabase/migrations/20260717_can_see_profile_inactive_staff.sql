-- Fix: a suspended (is_active = false) staff member became invisible to their
-- own gym's managers. can_see_profile()'s staff-sees-staff branch required the
-- TARGET's link to be active (them.is_active = true), so right after suspending
-- someone the manager could no longer read that person's profile row. Two
-- symptoms:
--   1. The staff detail page (/admin/instructors/[id]) read a null profile and
--      called notFound() → a 404 when trying to open a suspended staffer (e.g.
--      to reactivate them).
--   2. The staff list showed the suspended person as a nameless "Staff" row.
--
-- Drop the them.is_active requirement from the staff branch: the VIEWER must
-- still be active staff of the gym, but a suspended colleague at the SAME gym
-- stays visible so they can be viewed, managed and reactivated. Same-gym
-- scoping (me.gym_id = them.gym_id) is unchanged, so this does not widen
-- cross-tenant visibility. Idempotent (create or replace).
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
    OR EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
    );
$function$;

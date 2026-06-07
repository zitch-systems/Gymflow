-- S8: Two tables (reminders, staff) had RLS enabled but no policies, making
-- them effectively read-only-by-service-role. They aren't used by current
-- app code (verified via repo grep) — gym_staff_links supersedes `staff`
-- and reminder_logs supersedes `reminders` — but they're still in the
-- schema and the Supabase linter flags them (rls_enabled_no_policy).
--
-- Add owner/manager-scoped policies so the tables are consistent with the
-- rest of the gym-scoped schema and the linter passes. If a future feature
-- starts populating either table, the policies are already correct.

-- reminders: gym staff read; gym owner/manager write
CREATE POLICY reminders_select_staff ON public.reminders
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = reminders.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))));

CREATE POLICY reminders_write_owner ON public.reminders
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = reminders.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = reminders.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

-- staff: same pattern (gym staff read, owner/manager write)
CREATE POLICY staff_select_scoped ON public.staff
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = staff.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))));

CREATE POLICY staff_write_owner ON public.staff
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = staff.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = staff.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

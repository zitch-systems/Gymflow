-- S6: rewrite RLS policies so auth.uid() / auth.role() is evaluated once per query
-- (wrapped in a scalar subselect) instead of once per row. This is the Supabase
-- performance lint 0003 / auth_rls_initplan fix. Identical USING/WITH CHECK logic,
-- only the function call wrapping changes.

DROP POLICY IF EXISTS bh_delete_owner ON public.business_hours;
CREATE POLICY bh_delete_owner ON public.business_hours
  AS PERMISSIVE FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = business_hours.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS bh_insert_owner ON public.business_hours;
CREATE POLICY bh_insert_owner ON public.business_hours
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = business_hours.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS bh_select ON public.business_hours;
CREATE POLICY bh_select ON public.business_hours
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = business_hours.gym_id)))));

DROP POLICY IF EXISTS bh_update_owner ON public.business_hours;
CREATE POLICY bh_update_owner ON public.business_hours
  AS PERMISSIVE FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = business_hours.gym_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS checkins_insert_self ON public.check_ins;
CREATE POLICY checkins_insert_self ON public.check_ins
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK ((member_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS checkins_select_scoped ON public.check_ins;
CREATE POLICY checkins_select_scoped ON public.check_ins
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((member_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = check_ins.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))) OR is_platform_admin()));

DROP POLICY IF EXISTS bookings_instructor_select ON public.class_bookings;
CREATE POLICY bookings_instructor_select ON public.class_bookings
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM class_schedules cs
  WHERE ((cs.id = class_bookings.class_schedule_id) AND (cs.instructor_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS bookings_instructor_update ON public.class_bookings;
CREATE POLICY bookings_instructor_update ON public.class_bookings
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM class_schedules cs
  WHERE ((cs.id = class_bookings.class_schedule_id) AND (cs.instructor_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS bookings_member_insert ON public.class_bookings;
CREATE POLICY bookings_member_insert ON public.class_bookings
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK (((member_id = (SELECT auth.uid())) AND (gym_id IN ( SELECT gym_member_links.gym_id
   FROM gym_member_links
  WHERE (gym_member_links.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS bookings_member_select ON public.class_bookings;
CREATE POLICY bookings_member_select ON public.class_bookings
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ((member_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS bookings_member_update_own ON public.class_bookings;
CREATE POLICY bookings_member_update_own ON public.class_bookings
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING ((member_id = (SELECT auth.uid())))
  WITH CHECK ((member_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS bookings_staff_select ON public.class_bookings;
CREATE POLICY bookings_staff_select ON public.class_bookings
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = class_bookings.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))));

DROP POLICY IF EXISTS bookings_staff_update ON public.class_bookings;
CREATE POLICY bookings_staff_update ON public.class_bookings
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = class_bookings.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))));

DROP POLICY IF EXISTS classes_member_view ON public.classes;
CREATE POLICY classes_member_view ON public.classes
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((gym_id IN ( SELECT gym_member_links.gym_id
   FROM gym_member_links
  WHERE (gym_member_links.user_id = (SELECT auth.uid())))) AND (is_active = true)));

DROP POLICY IF EXISTS client_errors_select_admin ON public.client_errors;
CREATE POLICY client_errors_select_admin ON public.client_errors
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['owner'::text, 'manager'::text, 'platform_admin'::text]))))));

DROP POLICY IF EXISTS equipment_select_staff ON public.equipment;
CREATE POLICY equipment_select_staff ON public.equipment
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = equipment.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))) OR is_platform_admin()));

DROP POLICY IF EXISTS equipment_maintenance_gym ON public.equipment_maintenance;
CREATE POLICY equipment_maintenance_gym ON public.equipment_maintenance
  AS PERMISSIVE FOR ALL
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.gym_id = equipment_maintenance.gym_id)))));

DROP POLICY IF EXISTS expenses_staff_all ON public.expenses;
CREATE POLICY expenses_staff_all ON public.expenses
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = expenses.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = expenses.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))));

DROP POLICY IF EXISTS export_logs_select_staff ON public.export_logs;
CREATE POLICY export_logs_select_staff ON public.export_logs
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links
  WHERE ((gym_staff_links.gym_id = export_logs.gym_id) AND (gym_staff_links.user_id = (SELECT auth.uid())) AND (gym_staff_links.is_active = true)))));

DROP POLICY IF EXISTS gml_insert_self ON public.gym_member_links;
CREATE POLICY gml_insert_self ON public.gym_member_links
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS gml_select ON public.gym_member_links;
CREATE POLICY gml_select ON public.gym_member_links
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((((SELECT auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.user_id = (SELECT auth.uid())) AND (s.gym_id = gym_member_links.gym_id)))) OR is_platform_admin()));

DROP POLICY IF EXISTS gml_update_self ON public.gym_member_links;
CREATE POLICY gml_update_self ON public.gym_member_links
  AS PERMISSIVE FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = user_id))
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS gym_staff_links_all ON public.gym_staff_links;
CREATE POLICY gym_staff_links_all ON public.gym_staff_links
  AS PERMISSIVE FOR ALL
  TO public
  USING (((user_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.gym_id = gym_staff_links.gym_id) AND (profiles.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));

DROP POLICY IF EXISTS gym_staff_links_select_own ON public.gym_staff_links;
CREATE POLICY gym_staff_links_select_own ON public.gym_staff_links
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS gyms_delete_owner_only ON public.gyms;
CREATE POLICY gyms_delete_owner_only ON public.gyms
  AS PERMISSIVE FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = gyms.id) AND (p.role = 'owner'::text)))));

DROP POLICY IF EXISTS gyms_insert ON public.gyms;
CREATE POLICY gyms_insert ON public.gyms
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

DROP POLICY IF EXISTS gyms_update_owner_only ON public.gyms;
CREATE POLICY gyms_update_owner_only ON public.gyms
  AS PERMISSIVE FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.gym_id = gyms.id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS instructor_bank_details_insert_own ON public.instructor_bank_details;
CREATE POLICY instructor_bank_details_insert_own ON public.instructor_bank_details
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK ((instructor_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS instructor_bank_details_select_own ON public.instructor_bank_details;
CREATE POLICY instructor_bank_details_select_own ON public.instructor_bank_details
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ((instructor_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS instructor_bank_details_update_own ON public.instructor_bank_details;
CREATE POLICY instructor_bank_details_update_own ON public.instructor_bank_details
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING ((instructor_id = (SELECT auth.uid())))
  WITH CHECK ((instructor_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS ipay_insert_instructor ON public.instructor_payouts;
CREATE POLICY ipay_insert_instructor ON public.instructor_payouts
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK ((instructor_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS ipay_select ON public.instructor_payouts;
CREATE POLICY ipay_select ON public.instructor_payouts
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((instructor_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_payouts.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role])) AND (s.is_active = true))))));

DROP POLICY IF EXISTS ipay_update_admin ON public.instructor_payouts;
CREATE POLICY ipay_update_admin ON public.instructor_payouts
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_payouts.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role])) AND (s.is_active = true)))));

DROP POLICY IF EXISTS isess_insert_instructor ON public.instructor_sessions;
CREATE POLICY isess_insert_instructor ON public.instructor_sessions
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK (((instructor_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_sessions.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.role = 'instructor'::user_role) AND (s.is_active = true))))));

DROP POLICY IF EXISTS isess_select ON public.instructor_sessions;
CREATE POLICY isess_select ON public.instructor_sessions
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((instructor_id = (SELECT auth.uid())) OR (member_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_sessions.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true))))));

DROP POLICY IF EXISTS isess_update_instructor ON public.instructor_sessions;
CREATE POLICY isess_update_instructor ON public.instructor_sessions
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING ((instructor_id = (SELECT auth.uid())))
  WITH CHECK ((instructor_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS is_insert_self ON public.instructor_subscriptions;
CREATE POLICY is_insert_self ON public.instructor_subscriptions
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK ((member_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS is_select_self_or_gym ON public.instructor_subscriptions;
CREATE POLICY is_select_self_or_gym ON public.instructor_subscriptions
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((instructor_id = (SELECT auth.uid())) OR (member_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_subscriptions.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true))))));

DROP POLICY IF EXISTS is_update_self_or_instructor ON public.instructor_subscriptions;
CREATE POLICY is_update_self_or_instructor ON public.instructor_subscriptions
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING (((member_id = (SELECT auth.uid())) OR (instructor_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = instructor_subscriptions.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true))))));

DROP POLICY IF EXISTS msub_select_self_or_gym ON public.member_subscriptions;
CREATE POLICY msub_select_self_or_gym ON public.member_subscriptions
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((member_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = member_subscriptions.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true))))));

DROP POLICY IF EXISTS msub_update_self ON public.member_subscriptions;
CREATE POLICY msub_update_self ON public.member_subscriptions
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING ((member_id = (SELECT auth.uid())))
  WITH CHECK ((member_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS memberships_select_scoped ON public.memberships;
CREATE POLICY memberships_select_scoped ON public.memberships
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((member_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = memberships.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))) OR is_platform_admin()));

DROP POLICY IF EXISTS notif_select_self_or_gym ON public.notifications;
CREATE POLICY notif_select_self_or_gym ON public.notifications
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((user_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = notifications.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.role = ANY (ARRAY['gym_owner'::user_role, 'manager'::user_role])) AND (s.is_active = true))))));

DROP POLICY IF EXISTS payments_select_scoped ON public.payments;
CREATE POLICY payments_select_scoped ON public.payments
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((member_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = payments.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true)))) OR is_platform_admin()));

DROP POLICY IF EXISTS pa_select_self ON public.platform_admins;
CREATE POLICY pa_select_self ON public.platform_admins
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS pp_select_gym_or_admin ON public.platform_payments;
CREATE POLICY pp_select_gym_or_admin ON public.platform_payments
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = platform_payments.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.role = 'gym_owner'::user_role) AND (s.is_active = true)))) OR (EXISTS ( SELECT 1
   FROM platform_admins pa
  WHERE (pa.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = id));

DROP POLICY IF EXISTS profiles_update_no_escalation ON public.profiles;
CREATE POLICY profiles_update_no_escalation ON public.profiles
  AS PERMISSIVE FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = id))
  WITH CHECK ((((SELECT auth.uid()) = id) AND (NOT (role IS DISTINCT FROM ( SELECT p2.role
   FROM profiles p2
  WHERE (p2.id = (SELECT auth.uid())))))));

DROP POLICY IF EXISTS reminder_logs_select_staff ON public.reminder_logs;
CREATE POLICY reminder_logs_select_staff ON public.reminder_logs
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM gym_staff_links
  WHERE ((gym_staff_links.gym_id = reminder_logs.gym_id) AND (gym_staff_links.user_id = (SELECT auth.uid())) AND (gym_staff_links.is_active = true)))));

DROP POLICY IF EXISTS salary_payments_owner ON public.salary_payments;
CREATE POLICY salary_payments_owner ON public.salary_payments
  AS PERMISSIVE FOR ALL
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.gym_id = salary_payments.gym_id) AND (profiles.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));

DROP POLICY IF EXISTS cards_member_all ON public.saved_cards;
CREATE POLICY cards_member_all ON public.saved_cards
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING ((member_id = (SELECT auth.uid())))
  WITH CHECK ((member_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS signatures_member_insert ON public.waiver_signatures;
CREATE POLICY signatures_member_insert ON public.waiver_signatures
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK ((member_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS signatures_select_scoped ON public.waiver_signatures;
CREATE POLICY signatures_select_scoped ON public.waiver_signatures
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (((member_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM gym_staff_links s
  WHERE ((s.gym_id = waiver_signatures.gym_id) AND (s.user_id = (SELECT auth.uid())) AND (s.is_active = true))))));

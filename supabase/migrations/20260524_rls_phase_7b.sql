-- RLS Phase 7b — tighten wide-open (qual:true) policies that leak data
-- across gyms.
--
-- Scope: tables where every observed user-scoped SELECT already filters by
-- member_id=auth.uid() OR by gym_id under a staff context. Tightening to
-- "self or staff-of-gym" matches the code's current behaviour without
-- breaking anything.
--
-- Deferred to a later pass (need more design):
--   - profiles_select       (joined into staff/coach listings without gym filter)
--   - classes_select        (read by public landing page)
--   - class_schedules       (read by public landing page)
--   - membership_plans      (read by public landing page)
--   - gyms_select           (read by public landing page)
--   - waivers_select        (read by public signup form)
--
-- For class_bookings, split the catch-all qual:true ALL policy into per-cmd
-- policies (member self, gym staff, instructor of that class).

-- ─── memberships ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS memberships_select ON public.memberships;
CREATE POLICY memberships_select_scoped
  ON public.memberships
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = memberships.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ─── payments ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select_scoped
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = payments.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ─── equipment (gym-internal, staff only) ───────────────────────────────
DROP POLICY IF EXISTS equipment_select ON public.equipment;
CREATE POLICY equipment_select_staff
  ON public.equipment
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = equipment.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ─── check_ins ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS checkins_select ON public.check_ins;
CREATE POLICY checkins_select_scoped
  ON public.check_ins
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = check_ins.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ─── waiver_signatures (signed forms, gym-internal) ─────────────────────
DROP POLICY IF EXISTS signatures_all ON public.waiver_signatures;
CREATE POLICY signatures_member_insert
  ON public.waiver_signatures
  FOR INSERT
  TO authenticated
  WITH CHECK (member_id = auth.uid());
CREATE POLICY signatures_select_scoped
  ON public.waiver_signatures
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = waiver_signatures.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ─── class_bookings ─────────────────────────────────────────────────────
-- Drop the qual:true ALL catch-all. Keep the existing member-scoped
-- INSERT/SELECT/UPDATE policies (those already cover member self-service).
-- Add: staff sees + updates gym's bookings; instructor sees + updates
-- bookings for classes they teach (needed for coach attendance UI).
DROP POLICY IF EXISTS bookings_all ON public.class_bookings;

CREATE POLICY bookings_staff_select
  ON public.class_bookings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = class_bookings.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

CREATE POLICY bookings_staff_update
  ON public.class_bookings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = class_bookings.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

CREATE POLICY bookings_instructor_select
  ON public.class_bookings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_schedules cs
      WHERE cs.id = class_bookings.class_schedule_id
        AND cs.instructor_id = auth.uid()
    )
  );

CREATE POLICY bookings_instructor_update
  ON public.class_bookings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_schedules cs
      WHERE cs.id = class_bookings.class_schedule_id
        AND cs.instructor_id = auth.uid()
    )
  );

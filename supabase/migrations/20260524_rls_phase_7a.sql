-- RLS Phase 7a — add policies to zero-policy tables.
--
-- Audit found 11 public tables with RLS enabled but no policies. Most
-- critical: the 3 instructor_* tables the coach portal queries, plus
-- saved_cards / member_subscriptions / notifications used by the member
-- portal. With zero policies, user-scoped queries return empty and writes
-- fail; the admin client (service_role) bypasses RLS so existing code
-- using that client still works.
--
-- This migration only ADDS policies — it does not tighten existing wide-
-- open policies (qual:true). That cleanup is tracked separately as 7b.

-- ─── instructor_subscriptions ─────────────────────────────────────────────
CREATE POLICY "is_select_self_or_gym"
  ON public.instructor_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    instructor_id = auth.uid()
    OR member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = instructor_subscriptions.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

CREATE POLICY "is_insert_self"
  ON public.instructor_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (member_id = auth.uid());

CREATE POLICY "is_update_self_or_instructor"
  ON public.instructor_subscriptions
  FOR UPDATE
  TO authenticated
  USING (
    member_id = auth.uid()
    OR instructor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = instructor_subscriptions.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ─── instructor_sessions ──────────────────────────────────────────────────
CREATE POLICY "isess_select"
  ON public.instructor_sessions
  FOR SELECT
  TO authenticated
  USING (
    instructor_id = auth.uid()
    OR member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = instructor_sessions.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

CREATE POLICY "isess_insert_instructor"
  ON public.instructor_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    instructor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = instructor_sessions.gym_id
        AND s.user_id = auth.uid()
        AND s.role = 'instructor'
        AND s.is_active = true
    )
  );

CREATE POLICY "isess_update_instructor"
  ON public.instructor_sessions
  FOR UPDATE
  TO authenticated
  USING (instructor_id = auth.uid())
  WITH CHECK (instructor_id = auth.uid());

-- ─── instructor_payouts ───────────────────────────────────────────────────
CREATE POLICY "ipay_select"
  ON public.instructor_payouts
  FOR SELECT
  TO authenticated
  USING (
    instructor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = instructor_payouts.gym_id
        AND s.user_id = auth.uid()
        AND s.role IN ('gym_owner', 'manager')
        AND s.is_active = true
    )
  );

CREATE POLICY "ipay_insert_instructor"
  ON public.instructor_payouts
  FOR INSERT
  TO authenticated
  WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "ipay_update_admin"
  ON public.instructor_payouts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = instructor_payouts.gym_id
        AND s.user_id = auth.uid()
        AND s.role IN ('gym_owner', 'manager')
        AND s.is_active = true
    )
  );

-- ─── saved_cards (member tokenised Paystack authorisations) ───────────────
CREATE POLICY "cards_member_all"
  ON public.saved_cards
  FOR ALL
  TO authenticated
  USING (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid());

-- ─── member_subscriptions ────────────────────────────────────────────────
-- NOTE: there is also a `memberships` table with a wide-open select policy.
-- This is the older table — same name in spec — keep policies symmetric.
CREATE POLICY "msub_select_self_or_gym"
  ON public.member_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = member_subscriptions.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

CREATE POLICY "msub_update_self"
  ON public.member_subscriptions
  FOR UPDATE
  TO authenticated
  USING (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid());

-- ─── notifications ────────────────────────────────────────────────────────
CREATE POLICY "notif_select_self_or_gym"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = notifications.gym_id
        AND s.user_id = auth.uid()
        AND s.role IN ('gym_owner', 'manager')
        AND s.is_active = true
    )
  );

-- ─── expenses ─────────────────────────────────────────────────────────────
CREATE POLICY "expenses_staff_all"
  ON public.expenses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = expenses.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = expenses.gym_id
        AND s.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ─── platform_payments (gym platform-fee billing) ─────────────────────────
CREATE POLICY "pp_select_gym_or_admin"
  ON public.platform_payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_staff_links s
      WHERE s.gym_id = platform_payments.gym_id
        AND s.user_id = auth.uid()
        AND s.role = 'gym_owner'
        AND s.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.platform_admins pa
      WHERE pa.user_id = auth.uid()
    )
  );

-- ─── platform_admins ──────────────────────────────────────────────────────
CREATE POLICY "pa_select_self"
  ON public.platform_admins
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

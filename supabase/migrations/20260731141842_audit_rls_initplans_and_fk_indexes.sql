-- Fix Supabase advisor warnings found during the 2026-07-31 audit.
-- The policy changes preserve authorization behavior and cache auth.uid() once
-- per statement. The indexes cover foreign keys used by support and payout
-- review workflows.

create index if not exists idx_payout_change_requests_requested_by
  on public.payout_change_requests (requested_by);

create index if not exists idx_payout_change_requests_reviewed_by
  on public.payout_change_requests (reviewed_by);

create index if not exists idx_support_tickets_created_by
  on public.support_tickets (created_by);

create index if not exists idx_support_tickets_gym_id
  on public.support_tickets (gym_id);

alter policy notifications_self_update
  on public.notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy ibd_self_select
  on public.instructor_bank_details
  using (instructor_id = (select auth.uid()));

alter policy ibd_self_insert
  on public.instructor_bank_details
  with check (instructor_id = (select auth.uid()));

alter policy ibd_self_update
  on public.instructor_bank_details
  using (instructor_id = (select auth.uid()))
  with check (instructor_id = (select auth.uid()));

alter policy ipay_insert_instructor
  on public.instructor_payouts
  with check (
    instructor_id = (select auth.uid())
    and status = 'requested'::text
    and exists (
      select 1
      from public.gym_staff_links l
      where l.user_id = (select auth.uid())
        and l.gym_id = instructor_payouts.gym_id
        and l.role = 'instructor'::public.user_role
        and coalesce(l.is_active, true)
    )
  );

alter policy reminder_logs_staff_insert
  on public.reminder_logs
  with check (
    exists (
      select 1
      from public.gym_staff_links l
      where l.user_id = (select auth.uid())
        and l.gym_id = reminder_logs.gym_id
        and coalesce(l.is_active, true)
    )
  );

alter policy reminder_logs_staff_select
  on public.reminder_logs
  using (
    exists (
      select 1
      from public.gym_staff_links l
      where l.user_id = (select auth.uid())
        and l.gym_id = reminder_logs.gym_id
        and coalesce(l.is_active, true)
    )
  );

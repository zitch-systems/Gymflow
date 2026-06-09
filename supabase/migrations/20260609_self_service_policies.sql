-- Self-service policies backing the wiring pass:
--   1. members mark their own notifications read (inbox "Mark all read")
--   2. instructors manage their own payout bank account (coach Payouts)
--   3. staff write reminder delivery logs (admin Reminders "Send all due"/"Remind")
--
-- All statements are idempotent (drop policy if exists → create). The app code
-- degrades gracefully where a policy is missing, but the features only work
-- once this is applied.

-- 1 ── notifications: self UPDATE (only is_read/read_at are touched by the app;
--      user_id is pinned in USING + WITH CHECK so a member can't move a
--      notification to someone else).
alter table public.notifications enable row level security;
drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2 ── instructor_bank_details: instructors read/insert/update their own row
--      (PK instructor_id, upserted by saveBankDetails).
alter table public.instructor_bank_details enable row level security;
drop policy if exists ibd_self_select on public.instructor_bank_details;
create policy ibd_self_select on public.instructor_bank_details
  for select using (instructor_id = auth.uid());
drop policy if exists ibd_self_insert on public.instructor_bank_details;
create policy ibd_self_insert on public.instructor_bank_details
  for insert with check (instructor_id = auth.uid());
drop policy if exists ibd_self_update on public.instructor_bank_details;
create policy ibd_self_update on public.instructor_bank_details
  for update
  using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid());

-- 3 ── reminder_logs: active staff of a gym read + write that gym's log rows.
alter table public.reminder_logs enable row level security;
drop policy if exists reminder_logs_staff_select on public.reminder_logs;
create policy reminder_logs_staff_select on public.reminder_logs
  for select using (
    exists (
      select 1 from public.gym_staff_links l
      where l.user_id = auth.uid()
        and l.gym_id = reminder_logs.gym_id
        and coalesce(l.is_active, true)
    )
  );
drop policy if exists reminder_logs_staff_insert on public.reminder_logs;
create policy reminder_logs_staff_insert on public.reminder_logs
  for insert with check (
    exists (
      select 1 from public.gym_staff_links l
      where l.user_id = auth.uid()
        and l.gym_id = reminder_logs.gym_id
        and coalesce(l.is_active, true)
    )
  );

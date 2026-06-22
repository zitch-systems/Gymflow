-- Daily/weekly plans: months can't express sub-month durations. duration_days,
-- when set, is the source of truth; otherwise duration_months drives the period.
alter table public.membership_plans add column if not exists duration_days integer;

-- Platform billing (gym owner -> GymFlow): paid-through timestamp for the gym's
-- own GymFlow subscription (distinct from the 14-day trial in trial_ends_at).
alter table public.gyms add column if not exists subscription_current_period_end timestamptz;

-- Facility: staff could only read equipment. Allow active gym staff to manage it
-- (mirrors the existing expenses_staff_all policy). Additive + idempotent.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'equipment' and policyname = 'equipment_staff_write'
  ) then
    create policy equipment_staff_write on public.equipment
      for all to authenticated
      using (exists (
        select 1 from gym_staff_links s
        where s.gym_id = equipment.gym_id and s.user_id = (select auth.uid()) and s.is_active = true
      ))
      with check (exists (
        select 1 from gym_staff_links s
        where s.gym_id = equipment.gym_id and s.user_id = (select auth.uid()) and s.is_active = true
      ));
  end if;
end $$;

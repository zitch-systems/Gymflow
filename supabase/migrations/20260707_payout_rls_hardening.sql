-- Tighten instructor_payouts RLS ahead of wiring real money movement.
--
-- Two gaps in the baseline policies:
--   1. ipay_insert_instructor only checked instructor_id = auth.uid() — any
--      authenticated user could insert a payout row pointing at ANY gym_id,
--      and with any status (including 'paid'). Now the row must target a gym
--      where the caller is an ACTIVE instructor, and must start life as
--      'requested'.
--   2. ipay_update_admin had USING but no WITH CHECK — a gym's manager could
--      UPDATE a row they can see and move it to another gym_id / another
--      instructor. WITH CHECK now mirrors USING so the updated row must stay
--      inside the manager's gym.
--
-- Idempotent (drop + recreate).

drop policy if exists ipay_insert_instructor on public.instructor_payouts;
create policy ipay_insert_instructor on public.instructor_payouts
  for insert to authenticated
  with check (
    instructor_id = auth.uid()
    and status = 'requested'
    and exists (
      select 1 from public.gym_staff_links l
      where l.user_id = auth.uid()
        and l.gym_id = instructor_payouts.gym_id
        and l.role = 'instructor'::user_role
        and coalesce(l.is_active, true)
    )
  );

drop policy if exists ipay_update_admin on public.instructor_payouts;
create policy ipay_update_admin on public.instructor_payouts
  for update to authenticated
  using (has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role]))
  with check (has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role]));

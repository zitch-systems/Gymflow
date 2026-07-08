-- Front-desk check-in codes + check-out support.
--
-- Check-in becomes check-in/out: the schema already had checked_out_at and a
-- 'completed' status on check_ins, but nothing wrote them. And members who
-- can't (or won't) scan the door QR get a second path: generate a short-lived
-- 6-digit code on /checkin and read it to reception, who keys it into
-- /admin/staff-checkin — redeeming checks the member in, or out if they're
-- already inside.
--
--   1. checkin_codes — single-use numeric codes. A partial unique index keeps
--      one live instance of a code value per gym; redemption stamps used_at
--      (the "used_at IS NULL" guard on the UPDATE makes a concurrent double
--      redeem lose cleanly).
--   2. checkins_update_self — members may close their own open visit (self
--      check-out). Staff check-out already worked via checkins_update_staff.
--
-- Idempotent. Safe to re-run.

create table if not exists public.checkin_codes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone
);

-- Staff redeem by (gym, code); only one live instance of a code value per gym.
create unique index if not exists idx_checkin_codes_live on public.checkin_codes (gym_id, code) where (used_at is null);
create index if not exists idx_checkin_codes_member on public.checkin_codes (member_id, created_at desc);

alter table public.checkin_codes enable row level security;

-- Baseline grants tables to anon too; codes have no anonymous use, so only
-- signed-in users and the service role get access (RLS scopes the rest).
grant SELECT, INSERT, UPDATE, DELETE on public.checkin_codes to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.checkin_codes to service_role;

-- Members generate codes for themselves, at a gym they actively belong to.
drop policy if exists checkin_codes_insert_self on public.checkin_codes;
create policy checkin_codes_insert_self on public.checkin_codes as PERMISSIVE for INSERT to authenticated
  with check ((member_id = ( select auth.uid() )) and (gym_id in (
    select gym_member_links.gym_id from gym_member_links
    where gym_member_links.user_id = ( select auth.uid() ) and gym_member_links.is_active = true)));

-- Members see their own codes; gym staff see their gym's codes.
drop policy if exists checkin_codes_select_scoped on public.checkin_codes;
create policy checkin_codes_select_scoped on public.checkin_codes as PERMISSIVE for SELECT to authenticated
  using ((member_id = ( select auth.uid() ))
    or has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));

-- Members void their own codes (regeneration); staff stamp used_at on redeem.
drop policy if exists checkin_codes_update_self on public.checkin_codes;
create policy checkin_codes_update_self on public.checkin_codes as PERMISSIVE for UPDATE to authenticated
  using (member_id = ( select auth.uid() ))
  with check (member_id = ( select auth.uid() ));

drop policy if exists checkin_codes_update_staff on public.checkin_codes;
create policy checkin_codes_update_staff on public.checkin_codes as PERMISSIVE for UPDATE to authenticated
  using (has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]))
  with check (has_gym_role(gym_id, array['gym_owner'::user_role, 'manager'::user_role, 'front_desk'::user_role, 'accountant'::user_role]));

-- Self check-out: members may update their own visit rows (mirrors
-- checkins_insert_self, which already lets them create those rows).
drop policy if exists checkins_update_self on public.check_ins;
create policy checkins_update_self on public.check_ins as PERMISSIVE for UPDATE to authenticated
  using (member_id = ( select auth.uid() ))
  with check (member_id = ( select auth.uid() ));

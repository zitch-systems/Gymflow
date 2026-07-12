-- Batched schema for the "make onboarding + settings actually work" release:
--   1. gyms.notif_* — per-gym on/off for the three reminder channels the
--      Settings → Notifications section renders.
--   2. gyms.payouts_locked / gyms.payout_name_match_override — once a bank is
--      approved the row locks; further changes require superadmin review.
--   3. business_hours.session — split each day into morning/afternoon/evening,
--      or a single "all day" row. Existing rows default to 'all'.
--   4. payout_change_requests — pending owner-submitted bank changes awaiting
--      superadmin approval. Approval writes the request back into gyms; reject
--      leaves the current bank in place.
--
-- Idempotent. Safe to re-run.

alter table public.gyms
  add column if not exists notif_class_reminders  boolean not null default true,
  add column if not exists notif_renewal_nudges   boolean not null default true,
  add column if not exists notif_payment_receipts boolean not null default true,
  add column if not exists payouts_locked         boolean not null default false,
  add column if not exists payout_name_match_override boolean not null default false;

alter table public.business_hours
  add column if not exists session text not null default 'all';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'business_hours_session_check') then
    alter table public.business_hours
      add constraint business_hours_session_check
      check (session in ('all','morning','afternoon','evening'));
  end if;
end $$;

create table if not exists public.payout_change_requests (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  bank_name text not null,
  bank_code text not null,
  account_number text not null,
  account_name text not null,          -- name Paystack resolved for this account
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  name_matches boolean not null,       -- whether the resolved name matched the gym name
  allow_name_mismatch boolean not null default false, -- superadmin override on approval
  reject_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payout_change_requests_gym_idx on public.payout_change_requests (gym_id, status);
create index if not exists payout_change_requests_pending_idx on public.payout_change_requests (status, created_at) where status = 'pending';

alter table public.payout_change_requests enable row level security;

-- Owners/managers see their own gym's requests; platform admins see everything.
drop policy if exists payout_change_requests_read on public.payout_change_requests;
create policy payout_change_requests_read on public.payout_change_requests
  for select using (
    public.is_platform_admin()
    or public.has_gym_role(gym_id, array['gym_owner','manager']::user_role[])
  );

-- Writes (owner submitting a request, admin reviewing) all go through service-
-- role server actions, so no INSERT/UPDATE/DELETE policies for authenticated —
-- matches the pattern used for public.memberships / public.payments.

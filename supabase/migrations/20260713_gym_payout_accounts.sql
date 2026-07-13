-- Multiple payout accounts per gym (up to 4), with one marked active. The active
-- account is where member dues settle; switching among a gym's own saved accounts
-- is self-service (no platform approval — they're all the gym's accounts). This
-- supersedes the single bank-on-file + change-request flow.
--
-- gyms.paystack_subaccount_code and the gyms.bank_* columns are kept mirrored to
-- the active account by the server actions, so member billing (which reads
-- gyms.paystack_subaccount_code) keeps working unchanged.
--
-- RLS: owners/managers of the gym (and platform admins) manage the rows, so the
-- writes work with the normal user client — no service-role needed. Idempotent.

create table if not exists public.gym_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  bank_name text not null,
  bank_code text not null,
  account_number text not null,
  account_name text not null,
  verified boolean not null default false,
  is_active boolean not null default false,
  paystack_subaccount_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gym_payout_accounts_gym_idx on public.gym_payout_accounts (gym_id);
-- At most one active account per gym.
create unique index if not exists gym_payout_accounts_one_active
  on public.gym_payout_accounts (gym_id) where is_active;

alter table public.gym_payout_accounts enable row level security;

drop policy if exists gym_payout_accounts_rw on public.gym_payout_accounts;
create policy gym_payout_accounts_rw on public.gym_payout_accounts
  for all
  using (public.is_platform_admin() or public.has_gym_role(gym_id, array['gym_owner','manager']::user_role[]))
  with check (public.is_platform_admin() or public.has_gym_role(gym_id, array['gym_owner','manager']::user_role[]));

-- Backfill: move each gym's existing single bank-on-file into the new table as
-- its active account, so nobody loses their connected payout account.
insert into public.gym_payout_accounts (gym_id, bank_name, bank_code, account_number, account_name, verified, is_active, paystack_subaccount_code)
select g.id, g.bank_name, g.bank_code, g.account_number, coalesce(g.account_name, g.bank_name),
       (g.paystack_subaccount_code is not null), true, g.paystack_subaccount_code
from public.gyms g
where g.bank_name is not null and g.bank_code is not null and g.account_number is not null
  and not exists (select 1 from public.gym_payout_accounts a where a.gym_id = g.id);

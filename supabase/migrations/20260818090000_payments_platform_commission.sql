-- Record what the platform actually took from each member payment.
--
-- Until now the commission existed in exactly one place: percentage_charge on
-- the gym's Paystack subaccount. Nothing on our side recorded what was split,
-- so every commission figure in the console was `today's rate x all historical
-- GMV` — change a gym from 5% to 10% and last year's earnings silently
-- reprice. There was also no way to tell a payment that was split from one
-- that never touched a split at all.
--
-- Three columns, because one number cannot say all of it:
--
--   platform_settlement       how the money moved, not how much
--   platform_commission_pct   the rate that applied at the time
--   platform_commission_amount what the platform kept, in naira
--
-- All three are NULL on every existing row and on anything written by code
-- that predates this. NULL means "not recorded", which is honest; it does not
-- mean zero, and readers must not sum it as if it did.

alter table public.payments
  add column if not exists platform_settlement text,
  add column if not exists platform_commission_pct numeric(5,2),
  add column if not exists platform_commission_amount numeric(12,2);

comment on column public.payments.platform_settlement is
  'How this payment settled: split (routed through the gym''s Paystack subaccount, platform kept its percentage), platform_only (no subaccount, the whole charge landed in the platform account and the gym is owed its share), offline (cash/transfer taken at the gym, the platform never saw the money). NULL = recorded before this was tracked.';
comment on column public.payments.platform_commission_pct is
  'Percentage the platform kept, as it stood when this charge settled. Only meaningful with platform_settlement = split.';
comment on column public.payments.platform_commission_amount is
  'Naira the platform kept on this charge, from Paystack''s own fees_split where it reported one. Only set for platform_settlement = split.';

-- Only a split carries commission numbers. An offline payment never reached
-- the platform, and a platform_only one is money the platform is holding for
-- the gym rather than commission it earned; recording a figure against either
-- would inflate every total that sums this column.
alter table public.payments drop constraint if exists payments_platform_settlement_shape;
alter table public.payments add constraint payments_platform_settlement_shape check (
  (platform_settlement is null
     and platform_commission_pct is null
     and platform_commission_amount is null)
  or (platform_settlement in ('offline', 'platform_only')
     and platform_commission_pct is null
     and platform_commission_amount is null)
  or platform_settlement = 'split'
) not valid;
-- NOT VALID then VALIDATE: existing rows are all-NULL and satisfy it, but this
-- takes only a SHARE UPDATE EXCLUSIVE lock rather than blocking the payments
-- table for a full scan while money is moving through it.
alter table public.payments validate constraint payments_platform_settlement_shape;

-- payments_insert_staff lets gym staff record a cash payment (lib/actions/
-- admin-member.ts recordPayment), and that path legitimately stamps
-- platform_settlement = 'offline'. It has no business writing a commission
-- FIGURE: those come from Paystack, via the service role, and a staff-writable
-- number that feeds platform revenue reporting is a number a tenant can forge.
--
-- A column-level REVOKE cannot express this: Postgres will not carve a column
-- out of a table-wide grant, and `revoke insert (col) ... from authenticated`
-- against the baseline's `grant INSERT on public.payments to authenticated`
-- succeeds with a warning while changing nothing. A trigger is the mechanism
-- that actually holds. It RAISES rather than silently nulling — quietly
-- discarding a figure someone deliberately sent is the same class of bug this
-- migration exists to fix.
create or replace function public.payments_reject_tenant_commission()
returns trigger
language plpgsql
as $$
begin
  -- current_user is the role PostgREST switched to: anon / authenticated for a
  -- tenant-scoped client, service_role for the fulfilment path, postgres for
  -- migrations. Only the first two are refused.
  if current_user in ('anon', 'authenticated')
     and (new.platform_commission_pct is not null or new.platform_commission_amount is not null) then
    raise exception 'platform commission is recorded from Paystack at settlement and cannot be set by a tenant'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.payments_reject_tenant_commission() from public, anon, authenticated;

drop trigger if exists payments_reject_tenant_commission on public.payments;
create trigger payments_reject_tenant_commission
  before insert or update on public.payments
  for each row execute function public.payments_reject_tenant_commission();

-- The console sums commission per gym over a date range; without this it seq
-- scans payments to answer "what did GymFlow earn from this gym".
create index if not exists payments_commission_idx
  on public.payments (gym_id, payment_date desc)
  where platform_commission_amount is not null;

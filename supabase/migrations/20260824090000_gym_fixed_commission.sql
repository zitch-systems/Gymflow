-- Let the platform charge a gym a FLAT fee per member payment, not only a
-- percentage.
--
-- Until now a gym's commission was one number — gyms.platform_commission_pct —
-- applied by Paystack as the subaccount's percentage_charge. Some gyms are
-- negotiated on a flat "₦500 per subscription payment" instead, and there was
-- nowhere to put that, so it was being approximated with a percentage that
-- drifted from the deal every time a plan price changed.
--
-- Two columns: a mode discriminator and the flat amount.
--
-- NAIRA, not kobo. Every money column in this schema is numeric naira —
-- payments.amount, platform_payments.amount, membership_plans.price — and kobo
-- appears only at the Paystack boundary, where lib/plan-addon.ts planTotalKobo
-- already does the ×100. Storing kobo here would make this the single odd
-- column out and would put a conversion in front of every console read for the
-- sake of removing one at the single Paystack call site.
--
-- EXISTING ROWS: default 'percentage' with a 0.00 flat amount, so every gym
-- already on the platform keeps behaving exactly as it does today — at its
-- current platform_commission_pct, with nothing about its live Paystack split
-- changed by this migration. New gyms default the same way.

alter table public.gyms
  add column if not exists platform_commission_mode text not null default 'percentage',
  add column if not exists platform_commission_fixed_amount numeric(12,2) not null default 0;

comment on column public.gyms.platform_commission_mode is
  'How the platform''s cut of a member payment is computed: percentage (platform_commission_pct, applied by Paystack as the subaccount''s percentage_charge) or fixed (platform_commission_fixed_amount naira, sent per-transaction as Paystack''s transaction_charge).';
comment on column public.gyms.platform_commission_fixed_amount is
  'Flat naira the platform keeps per member payment when platform_commission_mode = fixed. Ignored in percentage mode. Naira like every other money column here; converted to kobo only at the Paystack boundary.';

alter table public.gyms drop constraint if exists gyms_platform_commission_mode_check;
alter table public.gyms add constraint gyms_platform_commission_mode_check
  check (platform_commission_mode in ('percentage', 'fixed'));

alter table public.gyms drop constraint if exists gyms_platform_commission_fixed_amount_check;
alter table public.gyms add constraint gyms_platform_commission_fixed_amount_check
  check (platform_commission_fixed_amount >= 0);

-- Note what is deliberately NOT here: nothing sets platform_commission_pct to
-- zero for a fixed-mode gym. The subaccount's stored percentage_charge stays
-- as the gym's percentage, because it is the fallback Paystack applies to any
-- charge that reaches it without a transaction_charge. Zeroing it would make
-- that failure mode "the platform earns nothing", and a 0% main-account share
-- also flips who bears the Paystack fee. See lib/paystack.ts initTransaction.

-- ── What was actually taken, on the payment row ─────────────────────────────
--
-- 20260818090000 records platform_settlement / platform_commission_pct /
-- platform_commission_amount per payment. The amount keeps working unchanged
-- in fixed mode (it comes from Paystack's own fees_split.integration), but the
-- pct is meaningless there — a flat ₦500 on a ₦5,000 charge is not "10%", and
-- storing it as one would make the console re-derive a rate that was never
-- agreed. So the basis is recorded alongside, and the pct is left NULL.

alter table public.payments
  add column if not exists platform_commission_basis text;

comment on column public.payments.platform_commission_basis is
  'What the platform''s cut on this charge was computed from: percentage (platform_commission_pct is the rate that applied) or flat (a fixed per-transaction charge; platform_commission_pct is NULL because no rate applies). NULL = recorded before this was tracked, or not a split.';

-- Existing rows are all NULL and stay NULL: they predate fixed mode entirely,
-- so every one of them that carries a pct was a percentage split — but NULL
-- honestly means "not recorded" here as it does in the sibling columns, and
-- backfilling a guess would be indistinguishable from a real record.
alter table public.payments drop constraint if exists payments_commission_basis_shape;
alter table public.payments add constraint payments_commission_basis_shape check (
  platform_commission_basis is null
  or (platform_commission_basis = 'percentage' and platform_settlement = 'split')
  or (platform_commission_basis = 'flat' and platform_settlement = 'split' and platform_commission_pct is null)
) not valid;
-- NOT VALID then VALIDATE, for the same reason as the sibling constraint in
-- 20260818090000: existing rows are all-NULL and satisfy it, and this avoids
-- an ACCESS EXCLUSIVE full scan of payments while money is moving through it.
alter table public.payments validate constraint payments_commission_basis_shape;

-- Same reasoning as payments_reject_tenant_commission in 20260818090000: this
-- column describes how the PLATFORM's cut was computed, and it is written from
-- the Paystack event by the service role. A tenant-set value would be a claim
-- about platform revenue made by the party it is charged to. Replacing the
-- function (rather than adding a second trigger) keeps one place to read.
create or replace function public.payments_reject_tenant_commission()
returns trigger
language plpgsql
as $$
begin
  -- current_user is the role PostgREST switched to: anon / authenticated for a
  -- tenant-scoped client, service_role for the fulfilment path, postgres for
  -- migrations. Only the first two are refused.
  if current_user in ('anon', 'authenticated')
     and (new.platform_commission_pct is not null
          or new.platform_commission_amount is not null
          or new.platform_commission_basis is not null) then
    raise exception 'platform commission is recorded from Paystack at settlement and cannot be set by a tenant'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.payments_reject_tenant_commission() from public, anon, authenticated;

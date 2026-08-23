-- Ledger integrity: stop a gym delete from wiping the ledger, close two
-- missing foreign keys, forbid negative amounts, and revoke destructive
-- grants that only the service role should ever exercise.
--
-- 1) GYM-SIDE CASCADE → RESTRICT. The 20260822 hardening plugged only the
--    profile-side cascade path — payments, instructor_payouts,
--    member_subscriptions had ON DELETE CASCADE on gym_id, so a
--    `delete from gyms where id = ...` (the gym owner can do this today via
--    gyms_delete_owner_only) would silently erase the tenant's entire
--    payment ledger, payout history and subscription history. Same class of
--    loss the 20260822 migration exists to prevent, just through the other
--    FK. Convert to RESTRICT so a gym delete FAILS while any ledger row
--    exists — operators can then take an explicit archival path
--    (docs/DATA_ERASURE.md).
--
-- 2) MISSING FKs. platform_payments.gym_id and salary_payments.gym_id are
--    typed `uuid not null` but have NO foreign key to public.gyms — the
--    Paystack fulfilment webhook or a manual salary insert could stamp a
--    nonexistent gym UUID and the row would sit orphaned, invisible to
--    every RLS policy and impossible to attribute in finance reports. Add
--    the FKs, RESTRICT on delete (same rationale as (1)).
--
-- 3) AMOUNT CHECK. payments.amount / platform_payments.amount /
--    salary_payments.amount / instructor_payouts.amount are `numeric not
--    null` with no non-negativity constraint. RLS' payments_insert_staff
--    is a bare role gate: a front-desk / accountant can INSERT
--    amount = -1_000_000 to reverse a real payment on the books, or 0 with
--    status='success' to inflate collected counts. Enforce `amount >= 0`
--    at the constraint layer where it can't be forgotten.
--
-- 4) REVOKE ledger writes from anon. The baseline schema granted the full
--    (DELETE, INSERT, UPDATE, TRUNCATE) surface to anon on payments,
--    platform_payments, salary_payments and audit_logs. RLS currently
--    denies anon (no matching policies), so this is not exploited today —
--    but a future migration that adds a permissive anon policy, or a
--    `disable row level security` toggle, would instantly expose the
--    ledger. The anon role never needed those grants; revoke them so RLS
--    is defense-in-depth, not the sole gate.

-- ── (1) Gym-side FKs: CASCADE → RESTRICT ──────────────────────────────────
alter table public.payments
  drop constraint if exists payments_gym_id_fkey;
alter table public.payments
  add constraint payments_gym_id_fkey
  foreign key (gym_id) references public.gyms(id) on delete restrict;

alter table public.instructor_payouts
  drop constraint if exists instructor_payouts_gym_id_fkey;
alter table public.instructor_payouts
  add constraint instructor_payouts_gym_id_fkey
  foreign key (gym_id) references public.gyms(id) on delete restrict;

alter table public.member_subscriptions
  drop constraint if exists member_subscriptions_gym_id_fkey;
alter table public.member_subscriptions
  add constraint member_subscriptions_gym_id_fkey
  foreign key (gym_id) references public.gyms(id) on delete restrict;

-- ── (2) Missing gym FKs on platform_payments and salary_payments ──────────
alter table public.platform_payments
  drop constraint if exists platform_payments_gym_id_fkey;
alter table public.platform_payments
  add constraint platform_payments_gym_id_fkey
  foreign key (gym_id) references public.gyms(id) on delete restrict;

alter table public.salary_payments
  drop constraint if exists salary_payments_gym_id_fkey;
alter table public.salary_payments
  add constraint salary_payments_gym_id_fkey
  foreign key (gym_id) references public.gyms(id) on delete restrict;

-- ── (3) Non-negative amount CHECKs ────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname='payments_amount_nonnegative' and conrelid='public.payments'::regclass) then
    alter table public.payments
      add constraint payments_amount_nonnegative check (amount >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='platform_payments_amount_nonnegative' and conrelid='public.platform_payments'::regclass) then
    alter table public.platform_payments
      add constraint platform_payments_amount_nonnegative check (amount >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='salary_payments_amount_nonnegative' and conrelid='public.salary_payments'::regclass) then
    alter table public.salary_payments
      add constraint salary_payments_amount_nonnegative check (amount >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='instructor_payouts_amount_nonnegative' and conrelid='public.instructor_payouts'::regclass) then
    alter table public.instructor_payouts
      add constraint instructor_payouts_amount_nonnegative check (amount >= 0);
  end if;
end $$;

-- ── (4) Revoke destructive ledger grants from anon ────────────────────────
-- Keep SELECT so any RLS policy that WOULD legitimately grant an anon read
-- keeps working (there are none today, but SELECT is the least dangerous
-- grant and the RLS is the real gate). Strip everything that could write.
revoke delete, insert, update, truncate, references, trigger on public.payments from anon;
revoke delete, insert, update, truncate, references, trigger on public.platform_payments from anon;
revoke delete, insert, update, truncate, references, trigger on public.salary_payments from anon;
revoke delete, insert, update, truncate, references, trigger on public.audit_logs from anon;

-- Also strip DELETE and TRUNCATE from authenticated on the ledger — no
-- app code deletes rows here (soft-delete or refund is the modeled path),
-- and no code truncates them ever. Service role keeps everything.
revoke delete, truncate on public.payments from authenticated;
revoke delete, truncate on public.platform_payments from authenticated;
revoke delete, truncate on public.salary_payments from authenticated;
revoke delete, truncate on public.audit_logs from authenticated;

-- One honest answer to "what has GymFlow actually earned in commission, and
-- from which gyms".
--
-- The figures already exist per payment (20260818090000 records the settlement,
-- rate and amount; 20260824090000 adds the basis), but there was nowhere to see
-- them added up. /superadmin/gyms/[id] sums them for ONE gym off its most
-- recent 200 payment rows, which is fine as a detail-page hint and wrong as a
-- platform total: a gym past 200 payments reports a total that is really a
-- partial. So the roll-up is done here, in the database, over every matching
-- row — a page cannot compute a true sum from a page of rows.
--
-- ONE ROW PER GYM that has any qualifying payment in the window, carrying both
-- what was earned and the gym's CURRENT commission arrangement, so a console row
-- reads "Trivion Gym — 20% — ₦42,300 from 31 payments". The current mode/rate is
-- deliberately taken from gyms (it describes the deal as it stands today) while
-- every money figure comes from the payment rows (they describe what actually
-- happened, at whatever rate applied then). Mixing those up — today's rate ×
-- historical volume — is the bug 20260818090000 exists to have ended.
--
-- WHAT COUNTS, and what does not:
--
--   · Only platform_settlement = 'split' carries commission. 'platform_only'
--     money landed in GymFlow's account with the gym owed the remainder — float
--     the platform is HOLDING, not revenue it earned — so it is returned in its
--     own held_* columns for the console to label as such, never added to
--     commission. 'offline' never reached the platform at all.
--   · Only successful payments. A refunded charge gave the member their money
--     back, so its commission was not kept either; counting it would leave the
--     console reporting earnings on money that went out again.
--   · A payment written before any of this was recorded has a NULL settlement.
--     NULL means "not recorded", not zero — those rows are counted separately
--     (unrecorded_payments) so a total can be read as complete or not, instead
--     of quietly under-reporting.

create or replace function public.platform_commission_by_gym(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  gym_id uuid,
  gym_name text,
  commission_mode text,
  commission_pct numeric,
  commission_fixed_amount numeric,
  commission_payments bigint,
  commission_total numeric,
  percentage_payments bigint,
  percentage_total numeric,
  flat_payments bigint,
  flat_total numeric,
  unclassified_payments bigint,
  unclassified_total numeric,
  unrecorded_payments bigint,
  held_payments bigint,
  held_total numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
begin
  -- SECURITY DEFINER because this reads every tenant's payments, which is
  -- exactly what no tenant policy allows. The gate is therefore the function's
  -- own, and it is the same one the console's pages use (requirePlatformAdmin →
  -- private.is_platform_admin), so a deactivated operator loses this with
  -- everything else (20260820120000). It RAISES rather than returning no rows:
  -- an empty result would be indistinguishable from "no commission yet", and a
  -- revenue report that silently reads as zero is worse than one that errors.
  if not private.is_platform_admin() then
    raise exception 'platform commission reporting is restricted to platform admins'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    g.id,
    g.name,
    g.platform_commission_mode,
    g.platform_commission_pct,
    g.platform_commission_fixed_amount,

    count(*) filter (where p.platform_settlement = 'split' and p.platform_commission_amount is not null),
    coalesce(sum(p.platform_commission_amount) filter (where p.platform_settlement = 'split'), 0),

    -- Percentage vs flat. basis = 'percentage' says so outright; a split with no
    -- basis but a recorded rate can only be a percentage one, because it was
    -- written before fixed mode existed at all (20260824090000) — that is a
    -- fact about when the row was written, not a guess at what was charged.
    count(*) filter (where p.platform_settlement = 'split' and p.platform_commission_amount is not null
                       and (p.platform_commission_basis = 'percentage'
                            or (p.platform_commission_basis is null and p.platform_commission_pct is not null))),
    coalesce(sum(p.platform_commission_amount) filter (
      where p.platform_settlement = 'split'
        and (p.platform_commission_basis = 'percentage'
             or (p.platform_commission_basis is null and p.platform_commission_pct is not null))), 0),

    count(*) filter (where p.platform_settlement = 'split' and p.platform_commission_amount is not null
                       and p.platform_commission_basis = 'flat'),
    coalesce(sum(p.platform_commission_amount) filter (
      where p.platform_settlement = 'split' and p.platform_commission_basis = 'flat'), 0),

    -- A split that recorded neither a basis nor a rate. Rare, and it is real
    -- money, so it gets its own bucket rather than being silently dropped from
    -- the split or silently folded into one — the three buckets always add back
    -- up to commission_total, which is what makes the breakdown checkable.
    count(*) filter (where p.platform_settlement = 'split' and p.platform_commission_amount is not null
                       and p.platform_commission_basis is null and p.platform_commission_pct is null),
    coalesce(sum(p.platform_commission_amount) filter (
      where p.platform_settlement = 'split'
        and p.platform_commission_basis is null and p.platform_commission_pct is null), 0),

    count(*) filter (where p.platform_settlement is null),

    -- Held, not earned: the gross charge, because there is no commission figure
    -- on a platform_only row to report (the check constraint forbids one).
    count(*) filter (where p.platform_settlement = 'platform_only'),
    coalesce(sum(p.amount) filter (where p.platform_settlement = 'platform_only'), 0)

  from public.payments p
  join public.gyms g on g.id = p.gym_id
  where
    -- status and payment_status are kept in step by trg_sync_payment_status, so
    -- either one answers "was this paid". Both are read anyway: they are two
    -- free-text columns rather than one enum, the console's other pages are
    -- split over which they filter on, and a row that disagrees with itself must
    -- not be able to land in a revenue total on the strength of its nicer half.
    lower(coalesce(nullif(p.status, ''), p.payment_status, '')) in ('success', 'successful', 'completed', 'paid')
    and lower(coalesce(p.status, '')) <> 'refunded'
    and lower(coalesce(p.payment_status, '')) <> 'refunded'
    -- payment_date is nullable and defaulted; created_at is the fallback, the
    -- same precedence the gym detail page and the overview chart already use.
    and (p_from is null or coalesce(p.payment_date, p.created_at) >= p_from)
    and (p_to is null or coalesce(p.payment_date, p.created_at) < p_to)
  group by g.id, g.name, g.platform_commission_mode, g.platform_commission_pct, g.platform_commission_fixed_amount
  -- Gyms that produced nothing in the window are not rows here: this is a
  -- breakdown of commission received, not a roster of gyms.
  having count(*) filter (where p.platform_settlement = 'split' and p.platform_commission_amount is not null) > 0
      or count(*) filter (where p.platform_settlement = 'platform_only') > 0
      or count(*) filter (where p.platform_settlement is null) > 0
  order by coalesce(sum(p.platform_commission_amount) filter (where p.platform_settlement = 'split'), 0) desc,
           g.name asc;
end;
$function$;

-- anon has no business here, and neither does a tenant-scoped session that is
-- not a platform admin — but the gate above, not the grant, is what enforces
-- the latter, because `authenticated` is the role every logged-in user holds.
revoke all on function public.platform_commission_by_gym(timestamptz, timestamptz) from public;
grant execute on function public.platform_commission_by_gym(timestamptz, timestamptz) to authenticated;
-- service_role is deliberately NOT granted: nothing on the money path needs this
-- (it is a reporting read), and the gate would refuse it anyway — service_role
-- carries no auth.uid(), so private.is_platform_admin() is false for it.

comment on function public.platform_commission_by_gym(timestamptz, timestamptz) is
  'Per-gym commission the platform actually kept over [p_from, p_to), aggregated across every qualifying payment row. Splits only, successful and non-refunded only; platform_only money is reported separately as held float and never as earnings. Platform admins only.';

-- The function scans payments filtered by settlement and bucketed by gym.
-- payments_commission_idx (20260818090000) is partial on
-- platform_commission_amount is not null, so it does not serve the platform_only
-- and unrecorded arms of this query, nor the date window across all gyms.
--
-- CREATE INDEX CONCURRENTLY cannot run inside the migration runner's
-- transaction, so this is a plain CREATE INDEX. It takes a SHARE lock that
-- blocks writes to payments for the build — acceptable here because it is one
-- index over a table in the low millions, and the alternative (an unindexed
-- full scan on every load of the revenue page) is a permanent cost rather than
-- a one-off one.
create index if not exists payments_settlement_date_idx
  on public.payments (gym_id, platform_settlement, payment_date desc);

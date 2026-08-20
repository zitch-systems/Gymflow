import { describe, expect, it } from 'vitest';
import { gymCommission, isChargeableKobo, subscriptionInitBody, transactionChargeKobo } from '@/lib/paystack-payloads';
import {
  PLATFORM_PLANS, PLAN_TIERS, BILLING_CYCLES, CYCLE_MONTHS, DEFAULT_CYCLE,
  planPrice, planAmountKobo, monthlyEquivalentKobo, cycleSavingPct,
} from '@/lib/platform-plans';

// Plan checkout — platform (gym → GymFlow) and member auto-renew — failed with
// Paystack's "Invalid Amount Sent" because the subscription init body carried a
// plan code and no amount. /transaction/initialize requires an amount even when
// the plan defines the price, so the presence of that field is the regression
// worth pinning.

describe('subscriptionInitBody', () => {
  const base = {
    email: 'owner@gym.ng',
    planCode: 'PLN_abc123',
    amountKobo: 3_799_900,
    metadata: { kind: 'platform_subscription' },
  };

  it('sends an amount alongside the plan code', () => {
    const body = subscriptionInitBody(base);
    expect(body.amount).toBe(3_799_900);
    expect(body.plan).toBe('PLN_abc123');
  });

  it('sends the currency, so a multi-currency Paystack account cannot guess', () => {
    expect(subscriptionInitBody(base).currency).toBe('NGN');
  });

  it('rounds to whole kobo — Paystack rejects a fractional amount', () => {
    // price * 100 on a numeric column is exactly where a fraction comes from.
    expect(subscriptionInitBody({ ...base, amountKobo: 1_399_900.0000001 }).amount).toBe(1_399_900);
    expect(subscriptionInitBody({ ...base, amountKobo: 250.5 }).amount).toBe(251);
  });

  it('omits callback_url entirely when there is none', () => {
    // Sending `callback_url: undefined` serialises to a missing key anyway, but
    // an empty string would override the dashboard's default callback.
    expect('callback_url' in subscriptionInitBody(base)).toBe(false);
    expect(subscriptionInitBody({ ...base, callbackUrl: 'https://gymflow.ng/billing/callback' }).callback_url)
      .toBe('https://gymflow.ng/billing/callback');
  });

  it('passes metadata through for the webhook to key on', () => {
    expect(subscriptionInitBody(base).metadata).toEqual({ kind: 'platform_subscription' });
  });
});

describe('isChargeableKobo', () => {
  it('accepts a real price', () => {
    expect(isChargeableKobo(1_399_900)).toBe(true);
  });

  it('rejects the values that produced Paystack-side errors', () => {
    for (const bad of [0, -100, null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      expect(isChargeableKobo(bad as number)).toBe(false);
    }
  });
});

describe('platform plan catalogue', () => {
  it('sells exactly two tiers on three billing cycles', () => {
    expect(PLAN_TIERS).toEqual(['starter', 'growth']);
    expect(BILLING_CYCLES).toEqual(['monthly', 'quarterly', 'annually']);
    // Monthly is the entry cycle: the default, and the baseline every saving is
    // quoted against.
    expect(DEFAULT_CYCLE).toBe('monthly');
  });

  it('gives every tier × cycle a chargeable amount', () => {
    // A plan with no price would reach Paystack as "Invalid Amount Sent" again.
    for (const tier of PLAN_TIERS) {
      for (const cycle of BILLING_CYCLES) {
        expect(isChargeableKobo(planAmountKobo(tier, cycle))).toBe(true);
      }
    }
  });

  it('points every tier × cycle at its own Paystack plan code env var', () => {
    // One code per plan is what lets a recurring charge — which carries none of
    // our metadata — be resolved back to a tier AND a cycle.
    const envs = PLAN_TIERS.flatMap((t) => BILLING_CYCLES.map((c) => planPrice(t, c).planCodeEnv));
    expect(new Set(envs).size).toBe(envs.length);
    for (const tier of PLAN_TIERS) {
      for (const cycle of BILLING_CYCLES) {
        expect(planPrice(tier, cycle).cycle).toBe(cycle);
      }
    }
  });

  it('keeps the tiers priced in ascending order on every cycle', () => {
    for (const cycle of BILLING_CYCLES) {
      const amounts = PLAN_TIERS.map((t) => planAmountKobo(t, cycle));
      expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
    }
  });

  it('makes each longer commitment strictly cheaper per month', () => {
    for (const tier of PLAN_TIERS) {
      const perMonth = BILLING_CYCLES.map((c) => monthlyEquivalentKobo(tier, c));
      // Strictly descending: committing longer must always buy a better rate,
      // or the toggle is offering a worse deal for more commitment.
      for (let i = 1; i < perMonth.length; i++) {
        expect(perMonth[i]).toBeLessThan(perMonth[i - 1]);
      }
      // Savings are quoted against monthly and shown as badges; pin them so a
      // price edit can't quietly turn "save 27%" into a lie.
      expect(cycleSavingPct(tier, DEFAULT_CYCLE)).toBe(0);
      expect(cycleSavingPct(tier, 'quarterly')).toBeGreaterThanOrEqual(5);
      expect(cycleSavingPct(tier, 'annually')).toBeGreaterThanOrEqual(20);
    }
  });

  it('charges more per cycle for a longer cycle', () => {
    // Guards the paid-through maths: a year must cost more in one go than a
    // quarter, and a quarter more than a month, even though each costs less
    // per month than the one before.
    for (const tier of PLAN_TIERS) {
      const perCharge = BILLING_CYCLES.map((c) => planAmountKobo(tier, c));
      for (let i = 1; i < perCharge.length; i++) {
        expect(perCharge[i]).toBeGreaterThan(perCharge[i - 1]);
      }
    }
    expect(CYCLE_MONTHS.monthly).toBe(1);
    expect(CYCLE_MONTHS.quarterly).toBe(3);
    expect(CYCLE_MONTHS.annually).toBe(12);
  });

  it('names every tier', () => {
    for (const tier of PLAN_TIERS) expect(PLATFORM_PLANS[tier].name.length).toBeGreaterThan(0);
  });
});

// A gym's cut can be a percentage of each member payment or a FLAT naira
// amount per payment. Paystack can only hold a percentage on the subaccount,
// so the flat deal travels per-charge as `transaction_charge` (kobo) on
// /transaction/initialize. That conversion and its clamp live here, pure,
// because lib/paystack.ts is server-only and unreachable from a test.

describe('gymCommission', () => {
  it('reads a flat arrangement off the gym row', () => {
    expect(gymCommission({ platform_commission_mode: 'fixed', platform_commission_fixed_amount: 500 }))
      .toEqual({ mode: 'fixed', fixedNaira: 500 });
  });

  it('reads numerics that arrive as strings, which is how PostgREST sends them', () => {
    expect(gymCommission({ platform_commission_mode: 'fixed', platform_commission_fixed_amount: '500.00' }).fixedNaira).toBe(500);
  });

  it('falls back to percentage for anything it does not recognise', () => {
    // Every gym on the platform is on a percentage. An unset, null or unknown
    // mode must mean the arrangement they already have, never "flat, ₦0".
    for (const gym of [null, undefined, {}, { platform_commission_mode: null }, { platform_commission_mode: 'whenever' }]) {
      expect(gymCommission(gym).mode).toBe('percentage');
    }
  });
});

describe('transactionChargeKobo', () => {
  it('sends the flat fee in kobo for a fixed-mode gym', () => {
    expect(transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 500 }, amountKobo: 500_000 })).toBe(50_000);
  });

  it('sends nothing at all for a percentage gym', () => {
    // Not 0 — a zero transaction_charge is a real instruction to take nothing,
    // which would override the subaccount's percentage and hand the gym the
    // whole charge.
    expect(transactionChargeKobo({ commission: { mode: 'percentage', fixedNaira: 500 }, amountKobo: 500_000 })).toBeNull();
    expect(transactionChargeKobo({ commission: null, amountKobo: 500_000 })).toBeNull();
  });

  it('sends nothing for a flat fee that is zero, missing or nonsense', () => {
    for (const fixedNaira of [0, null, NaN, -50]) {
      expect(transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira }, amountKobo: 500_000 })).toBeNull();
    }
  });

  it('clamps a flat fee larger than the payment, and leaves the gym a share', () => {
    // A ₦5,000 flat fee on a ₦1,000 renewal is nonsense arithmetic, and
    // Paystack's own answer to it is either a rejected checkout — the member
    // cannot pay, for a reason entirely the platform's — or taking everything.
    // Clamping picks the safe direction, but clamping to the amount ITSELF is
    // the rejected checkout: lib/paystack.ts sends bearer:'subaccount', so the
    // gym's share is where Paystack's own fee comes from, and a share of
    // exactly ₦0 has nothing to pay it with.
    const clamped = transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 5_000 }, amountKobo: 100_000 });
    expect(clamped).not.toBeNull();
    expect(clamped!).toBeLessThan(100_000);
    // The headroom left behind covers 1.5% + ₦100 of the charge, which is what
    // a local NGN transaction costs.
    expect(100_000 - clamped!).toBeGreaterThanOrEqual(Math.ceil(100_000 * 0.015) + 10_000);
  });

  it('leaves that headroom even when the flat fee exactly equals the payment', () => {
    // The boundary case: a ₦500 flat deal and a ₦500 day pass. min(amount,
    // charge) is a legal-looking answer that zeroes the subaccount.
    const exact = transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 500 }, amountKobo: 50_000 });
    expect(exact).not.toBeNull();
    expect(exact!).toBeLessThan(50_000);
  });

  it('sends no flat fee at all when the payment cannot carry one', () => {
    // ₦50 is less than the fee on itself. Sending anything would leave the
    // subaccount short; sending nothing falls back to the subaccount's
    // percentage, which is a real arrangement rather than a failed checkout.
    expect(transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 500 }, amountKobo: 5_000 })).toBeNull();
  });

  it('is unchanged for a flat fee the payment comfortably covers', () => {
    // The ordinary case must not pay for the boundary: ₦500 out of ₦5,000.
    expect(transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 500 }, amountKobo: 500_000 })).toBe(50_000);
  });

  it('rounds before clamping, so a rounded-up fee cannot slip past the ceiling', () => {
    const clamped = transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 1_000.004 }, amountKobo: 100_000 });
    expect(clamped!).toBeLessThan(100_000);
    // ...and an ordinary fractional naira figure is still integer kobo.
    expect(transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 12.345 }, amountKobo: 500_000 })).toBe(1_235);
  });

  it('sends nothing when there is no amount to take it from', () => {
    for (const amountKobo of [0, -1, NaN]) {
      expect(transactionChargeKobo({ commission: { mode: 'fixed', fixedNaira: 500 }, amountKobo })).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { isChargeableKobo, subscriptionInitBody } from '@/lib/paystack-payloads';
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
  it('sells exactly two tiers on two billing cycles', () => {
    expect(PLAN_TIERS).toEqual(['starter', 'growth']);
    expect(BILLING_CYCLES).toEqual(['quarterly', 'annually']);
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

  it('makes a longer commitment cheaper per month, never dearer', () => {
    for (const tier of PLAN_TIERS) {
      const base = monthlyEquivalentKobo(tier, DEFAULT_CYCLE);
      for (const cycle of BILLING_CYCLES) {
        expect(monthlyEquivalentKobo(tier, cycle)).toBeLessThanOrEqual(base);
      }
      // The annual saving is the headline on the pricing page; pin it so a price
      // edit can't quietly turn "save 20%" into a lie.
      expect(cycleSavingPct(tier, 'annually')).toBeGreaterThanOrEqual(15);
      expect(cycleSavingPct(tier, DEFAULT_CYCLE)).toBe(0);
    }
  });

  it('charges more per cycle for a longer cycle', () => {
    // Guards the paid-through maths: a year must cost more in one go than a
    // quarter, even though it costs less per month.
    for (const tier of PLAN_TIERS) {
      expect(planAmountKobo(tier, 'annually')).toBeGreaterThan(planAmountKobo(tier, 'quarterly'));
    }
    expect(CYCLE_MONTHS.quarterly).toBe(3);
    expect(CYCLE_MONTHS.annually).toBe(12);
  });

  it('names every tier', () => {
    for (const tier of PLAN_TIERS) expect(PLATFORM_PLANS[tier].name.length).toBeGreaterThan(0);
  });
});

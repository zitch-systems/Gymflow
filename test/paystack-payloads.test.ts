import { describe, expect, it } from 'vitest';
import { isChargeableKobo, subscriptionInitBody } from '@/lib/paystack-payloads';
import { PLATFORM_PLANS, PLAN_TIERS } from '@/lib/platform-plans';

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
  it('gives every tier a chargeable amount', () => {
    // A tier with no price would reach Paystack as "Invalid Amount Sent" again.
    for (const tier of PLAN_TIERS) {
      expect(isChargeableKobo(PLATFORM_PLANS[tier].amountKobo)).toBe(true);
    }
  });

  it('keeps the tiers priced in ascending order', () => {
    const amounts = PLAN_TIERS.map((t) => PLATFORM_PLANS[t].amountKobo);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
  });
});

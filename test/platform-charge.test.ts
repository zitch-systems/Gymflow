import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planFromCharge, periodEndFor } from '@/lib/platform-charge';
import { planAmountKobo, planPrice } from '@/lib/platform-plans';

// Resolving what a platform charge bought decides two things that move money:
// the amount we accept as valid, and how far the gym's paid-through date jumps.
// Getting the cycle wrong on a quarterly plan bills correctly but cuts the gym
// off two months early; getting it wrong the other way gives away access.

const CODES = {
  starterQuarterly: 'PLN_sq',
  starterAnnual: 'PLN_sa',
  growthQuarterly: 'PLN_gq',
  growthAnnual: 'PLN_ga',
  legacyStarterMonthly: 'PLN_old_starter',
  legacyScaleMonthly: 'PLN_old_scale',
};

const ENV_KEYS = [
  'PAYSTACK_PLAN_STARTER_QUARTERLY', 'PAYSTACK_PLAN_STARTER_ANNUAL',
  'PAYSTACK_PLAN_GROWTH_QUARTERLY', 'PAYSTACK_PLAN_GROWTH_ANNUAL',
  'PAYSTACK_PLAN_STARTER', 'PAYSTACK_PLAN_GROWTH', 'PAYSTACK_PLAN_SCALE',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.PAYSTACK_PLAN_STARTER_QUARTERLY = CODES.starterQuarterly;
  process.env.PAYSTACK_PLAN_STARTER_ANNUAL = CODES.starterAnnual;
  process.env.PAYSTACK_PLAN_GROWTH_QUARTERLY = CODES.growthQuarterly;
  process.env.PAYSTACK_PLAN_GROWTH_ANNUAL = CODES.growthAnnual;
  process.env.PAYSTACK_PLAN_STARTER = CODES.legacyStarterMonthly;
  process.env.PAYSTACK_PLAN_SCALE = CODES.legacyScaleMonthly;
  delete process.env.PAYSTACK_PLAN_GROWTH;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('planFromCharge — current plans', () => {
  it('reads tier AND cycle off the plan code alone', () => {
    // The recurring-charge case: Paystack echoes none of our metadata, so the
    // code is all there is.
    expect(planFromCharge({}, { plan_code: CODES.starterQuarterly })).toEqual({
      tier: 'starter', cycle: 'quarterly', months: 3, expectedKobo: planAmountKobo('starter', 'quarterly'),
    });
    expect(planFromCharge({}, { plan_code: CODES.growthAnnual })).toEqual({
      tier: 'growth', cycle: 'annually', months: 12, expectedKobo: planAmountKobo('growth', 'annually'),
    });
  });

  it('lets the plan code win over contradicting metadata', () => {
    // Paystack billed the annual plan; metadata claiming quarterly must not
    // shorten the period the gym actually paid for.
    const got = planFromCharge(
      { plan: 'growth', cycle: 'quarterly' },
      { plan_code: CODES.growthAnnual },
    );
    expect(got).toEqual({
      tier: 'growth', cycle: 'annually', months: 12, expectedKobo: planAmountKobo('growth', 'annually'),
    });
  });

  it('expects the amount of the exact tier × cycle, not the tier', () => {
    const q = planFromCharge({}, { plan_code: CODES.growthQuarterly })!;
    const a = planFromCharge({}, { plan_code: CODES.growthAnnual })!;
    expect(q.expectedKobo).toBe(planPrice('growth', 'quarterly').amountKobo);
    expect(a.expectedKobo).toBe(planPrice('growth', 'annually').amountKobo);
    expect(a.expectedKobo).not.toBe(q.expectedKobo);
  });
});

describe('planFromCharge — metadata fallback', () => {
  it('falls back to our init metadata when the code is unknown', () => {
    const got = planFromCharge({ plan: 'growth', cycle: 'annually' }, { plan_code: 'PLN_drifted' });
    expect(got).toEqual({
      tier: 'growth', cycle: 'annually', months: 12, expectedKobo: planAmountKobo('growth', 'annually'),
    });
  });

  it('assumes the default cycle for a pre-cycle metadata blob', () => {
    // An in-flight checkout started before cycles existed still has to fulfil.
    const got = planFromCharge({ plan: 'starter' }, {});
    expect(got).toEqual({
      tier: 'starter', cycle: 'quarterly', months: 3, expectedKobo: planAmountKobo('starter', 'quarterly'),
    });
  });

  it('rejects a retired tier in metadata rather than guessing', () => {
    expect(planFromCharge({ plan: 'scale' }, {})).toBeNull();
    expect(planFromCharge({}, {})).toBeNull();
    expect(planFromCharge({ plan: 'starter', cycle: 'weekly' }, {})).toEqual({
      tier: 'starter', cycle: 'quarterly', months: 3, expectedKobo: planAmountKobo('starter', 'quarterly'),
    });
  });
});

describe('planFromCharge — retired monthly plans', () => {
  it('still fulfils a gym billing on its old monthly plan', () => {
    // These gyms keep being charged by Paystack until they resubscribe. Dropping
    // the charge would stop extending a gym that is still paying.
    expect(planFromCharge({}, { plan_code: CODES.legacyStarterMonthly })).toEqual({
      tier: 'starter', cycle: null, months: 1, expectedKobo: 1_399_900,
    });
  });

  it('maps the retired Scale plan onto Growth, where its features now live', () => {
    expect(planFromCharge({}, { plan_code: CODES.legacyScaleMonthly })).toEqual({
      tier: 'growth', cycle: null, months: 1, expectedKobo: 11_999_900,
    });
  });

  it('records no cycle for a legacy charge', () => {
    // Writing a cycle here would misreport the gym on every billing surface.
    expect(planFromCharge({}, { plan_code: CODES.legacyStarterMonthly })!.cycle).toBeNull();
  });

  it('ignores a legacy env var that is not set', () => {
    // PAYSTACK_PLAN_GROWTH is deleted in beforeEach — an empty env var must not
    // match a charge that carries no plan code at all.
    expect(planFromCharge({}, { plan_code: '' })).toBeNull();
    expect(planFromCharge({}, {})).toBeNull();
  });
});

describe('periodEndFor', () => {
  it('advances by the cycle length, not a month', () => {
    const paid = new Date('2026-01-15T10:00:00.000Z');
    expect(periodEndFor(paid, 3).toISOString().slice(0, 10)).toBe('2026-04-15');
    expect(periodEndFor(paid, 12).toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(periodEndFor(paid, 1).toISOString().slice(0, 10)).toBe('2026-02-15');
  });

  it('does not mutate the date it was given', () => {
    const paid = new Date('2026-01-15T10:00:00.000Z');
    periodEndFor(paid, 12);
    expect(paid.toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });

  it('rolls a short-month overflow forward rather than backward', () => {
    // 30 Nov + 3 months = 28/29 Feb in Date's arithmetic → 2 Mar. Documented
    // because it always lands AFTER the true anniversary, never before: a gym is
    // never cut off early.
    const end = periodEndFor(new Date('2026-11-30T00:00:00.000Z'), 3);
    expect(end.getTime()).toBeGreaterThan(new Date('2027-02-28T00:00:00.000Z').getTime());
  });
});

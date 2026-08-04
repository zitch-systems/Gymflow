import { describe, expect, it } from 'vitest';
import {
  TRAINER_ADDON_MAX, offersTrainer, planTotalKobo, planTotalPrice,
  resolveTrainerOptIn, trainerAddonCosts, trainerAddonPrice,
} from '@/lib/plan-addon';

// The optional private-trainer add-on's arithmetic. Everything here decides how
// much money a member is charged, so the cases that matter most are the ones
// where a plan and a request disagree: the plan row must always win.

const PLAIN = { price: 20_000, trainer_addon_enabled: false, trainer_addon_price: 0 };
const PAID = { price: 20_000, trainer_addon_enabled: true, trainer_addon_price: 15_000 };
const BUNDLED = { price: 35_000, trainer_addon_enabled: true, trainer_addon_price: 0 };

describe('offersTrainer', () => {
  it('is true only when the gym switched the add-on on', () => {
    expect(offersTrainer(PAID)).toBe(true);
    expect(offersTrainer(BUNDLED)).toBe(true);
    expect(offersTrainer(PLAIN)).toBe(false);
  });

  it('treats a missing plan or missing column as no add-on', () => {
    expect(offersTrainer(null)).toBe(false);
    expect(offersTrainer(undefined)).toBe(false);
    expect(offersTrainer({})).toBe(false);
  });
});

describe('trainerAddonPrice', () => {
  it('is the configured price when the add-on is on', () => {
    expect(trainerAddonPrice(PAID)).toBe(15_000);
  });

  it('is 0 for a bundled-free trainer and for a plan that offers none', () => {
    expect(trainerAddonPrice(BUNDLED)).toBe(0);
    expect(trainerAddonPrice(PLAIN)).toBe(0);
  });

  it('ignores a stored price on a plan whose add-on is switched off', () => {
    // Switching the add-on off must stop members being charged for it, even
    // though savePlan leaves no price behind and older rows might.
    expect(trainerAddonPrice({ trainer_addon_enabled: false, trainer_addon_price: 15_000 })).toBe(0);
  });

  it('clamps junk and negatives to 0 rather than discounting the plan', () => {
    expect(trainerAddonPrice({ trainer_addon_enabled: true, trainer_addon_price: -5_000 })).toBe(0);
    expect(trainerAddonPrice({ trainer_addon_enabled: true, trainer_addon_price: Number.NaN })).toBe(0);
    expect(trainerAddonPrice({ trainer_addon_enabled: true, trainer_addon_price: null })).toBe(0);
  });

  it('caps an absurd stored price at the documented ceiling', () => {
    expect(trainerAddonPrice({ trainer_addon_enabled: true, trainer_addon_price: 1e12 })).toBe(TRAINER_ADDON_MAX);
  });

  it('reads a numeric column that arrives as a string', () => {
    // numeric(12,2) comes back from PostgREST as a string.
    expect(trainerAddonPrice({ trainer_addon_enabled: true, trainer_addon_price: '15000.00' })).toBe(15_000);
  });
});

describe('trainerAddonCosts', () => {
  it('separates a surcharge from a bundled perk', () => {
    expect(trainerAddonCosts(PAID)).toBe(true);
    expect(trainerAddonCosts(BUNDLED)).toBe(false);
    expect(trainerAddonCosts(PLAIN)).toBe(false);
  });
});

describe('planTotalPrice', () => {
  it('adds the add-on only when the member took it', () => {
    expect(planTotalPrice(PAID, true)).toBe(35_000);
    expect(planTotalPrice(PAID, false)).toBe(20_000);
  });

  it('charges the plan price when a member asks for a trainer the plan does not offer', () => {
    // The tick can't exist in the UI for this plan, so reaching here means the
    // request was forged. It must not change the price in either direction.
    expect(planTotalPrice(PLAIN, true)).toBe(20_000);
  });

  it('leaves a bundled-free trainer at the plan price', () => {
    expect(planTotalPrice(BUNDLED, true)).toBe(35_000);
    expect(planTotalPrice(BUNDLED, false)).toBe(35_000);
  });

  it('treats an unusable base price as 0 instead of NaN', () => {
    expect(planTotalPrice({ price: null, trainer_addon_enabled: true, trainer_addon_price: 15_000 }, true)).toBe(15_000);
  });
});

describe('planTotalKobo', () => {
  it('is the total in kobo, rounded once', () => {
    expect(planTotalKobo(PAID, true)).toBe(3_500_000);
    expect(planTotalKobo(PAID, false)).toBe(2_000_000);
  });

  it('rounds a fractional naira total to a whole kobo integer', () => {
    // Paystack rejects a non-integer amount, so this must never emit one.
    const total = planTotalKobo({ price: 1_000.005, trainer_addon_enabled: true, trainer_addon_price: 0.99 }, true);
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(total).toBe(100_100);
  });
});

describe('resolveTrainerOptIn', () => {
  it('grants the add-on only when the plan offers it AND the member asked', () => {
    expect(resolveTrainerOptIn(PAID, true)).toBe(true);
    expect(resolveTrainerOptIn(PAID, false)).toBe(false);
    expect(resolveTrainerOptIn(PLAIN, true)).toBe(false);
  });

  it('rejects truthy non-booleans from checkout metadata', () => {
    // metadata round-trips through Paystack as JSON, so the flag is whatever
    // came back — only a real `true` counts.
    for (const forged of ['true', 1, 'yes', {}, []]) {
      expect(resolveTrainerOptIn(PAID, forged)).toBe(false);
    }
  });

  it('is false for legacy checkouts that predate the flag', () => {
    expect(resolveTrainerOptIn(PAID, undefined)).toBe(false);
    expect(resolveTrainerOptIn(PAID, null)).toBe(false);
  });
});

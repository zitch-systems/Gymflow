import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TRAINER_ADDON_MAX, offersTrainer, planTotalKobo, planTotalPrice,
  resolveTrainerOptIn, trainerAddonCosts, trainerAddonPrice,
} from '@/lib/plan-addon';

// Every .ts/.tsx under `dir`, repo-relative — same walk as
// test/use-server-exports.test.ts, for the source lock at the bottom.
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(__dirname, '..', dir))) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(resolve(__dirname, '..', rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

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

// ── The cached Paystack Plan codes ─────────────────────────────────────────
//
// A Paystack Plan pins ONE amount, and /transaction/initialize IGNORES the
// amount parameter when a plan code is present (lib/paystack.ts) — so a stale
// cached code is not a display bug, it is the price the member is actually
// charged, on checkout and on every recurring cycle after it.
//
// savePlan cleared paystack_plan_code_trainer on any change to the combined
// total and left paystack_plan_code — the BASE plan's cached code — alone,
// and nothing else in the repo ever nulled it. A gym raising Monthly from
// ₦10,000 to ₦15,000 therefore had the next member to opt into auto-renew
// quoted ₦15,000 by the plan list and billed ₦10,000 forever (or overbilled,
// if the price came down). Source locks, because savePlan is a 'use server'
// action behind requireStaff() and a redirect().

describe('a price edit invalidates the cached Paystack Plan', () => {
  const src = readFileSync(resolve(__dirname, '..', 'lib/actions/admin-class.ts'), 'utf8');

  it('clears the base code when the plan price actually moved', () => {
    expect(src).toContain('const priceChanged = before != null && Number(before.price) !== price');
    expect(src).toContain('...(priceChanged ? { paystack_plan_code: null } : {})');
  });

  it('still clears the with-trainer code on anything that moves the combined total', () => {
    // The half that already worked, pinned so this fix can't take it with it:
    // the trainer Plan is priced at plan + add-on, so the add-on columns move
    // it even when the base price didn't.
    expect(src).toContain('...(totalChanged ? { paystack_plan_code_trainer: null } : {})');
    for (const term of ['Boolean(before.trainer_addon_enabled) !== trainerEnabled', 'Number(before.trainer_addon_price ?? 0) !== trainerPrice']) {
      expect(src).toContain(term);
    }
    expect(src).toContain('const totalChanged = priceChanged ||');
  });

  it('and ensurePlanCode is still the only place that mints one', () => {
    // If a second place started caching a code it would need this invalidation
    // too — and would not have it. lib/database.types.ts is the generated
    // column list, not a writer.
    const writers = new Set(['lib/actions/admin-class.ts', 'lib/actions/member-billing.ts', 'lib/database.types.ts']);
    for (const file of sourceFiles('lib').concat(sourceFiles('app'), sourceFiles('components'))) {
      if (writers.has(file)) continue;
      expect(readFileSync(resolve(__dirname, '..', file), 'utf8'), `${file} writes a cached plan code`)
        .not.toMatch(/paystack_plan_code(_trainer)?\s*:/);
    }
  });
});

// What a platform (gym → GymFlow) charge bought, resolved from the Paystack
// event alone.
//
// Deliberately NOT 'server-only' so the vitest suite can exercise the resolution
// and the period arithmetic without a Paystack account or a DB — the same reason
// lib/reconcile-core.ts and lib/paystack-event-state.ts are kept pure. Reads
// PAYSTACK_PLAN_* from the environment, so it must never be imported by a client
// component.

import {
  isPlanTier, isBillingCycle, planAmountKobo, cycleMonths,
  PLATFORM_PLANS, DEFAULT_CYCLE, type PlanTier, type BillingCycle,
} from '@/lib/platform-plans';

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

// Retired plans: sold once, absent from PLATFORM_PLANS, but still able to fire a
// recurring charge.success that has to fulfil or the gym silently stops being
// extended. Only Scale is here — the Starter and Growth monthly Plans are part
// of the catalogue again, so their subscribers are ordinary monthly customers.
//
// Scale maps to Growth, which is where its features now live, and bills monthly
// like the plan it was. Its price is NOT Growth's monthly price, which is why
// the expected amount travels with the charge rather than being looked up.
export const LEGACY_PLANS: { env: string; tier: PlanTier; cycle: BillingCycle; amountKobo: number }[] = [
  { env: 'PAYSTACK_PLAN_SCALE', tier: 'growth', cycle: 'monthly', amountKobo: 11_999_900 },
];

// Everything a charge needs to be applied: what it bought, what it should have
// cost, and how far it moves the paid-through date.
export type ChargePlan = { tier: PlanTier; cycle: BillingCycle; months: number; expectedKobo: number };

// The set of Paystack plan codes we recognise as current platform plans (from
// env). One code per tier × cycle, so a code alone identifies the charge
// completely — which is what makes recurring charges resolvable.
export function platformPlanCodes(): Map<string, { tier: PlanTier; cycle: BillingCycle }> {
  const m = new Map<string, { tier: PlanTier; cycle: BillingCycle }>();
  for (const p of Object.values(PLATFORM_PLANS)) {
    for (const price of Object.values(p.prices)) {
      const code = process.env[price.planCodeEnv];
      if (code) m.set(code, { tier: p.tier, cycle: price.cycle });
    }
  }
  return m;
}

function fromCatalogue(tier: PlanTier, cycle: BillingCycle): ChargePlan {
  return { tier, cycle, months: cycleMonths(cycle), expectedKobo: planAmountKobo(tier, cycle) };
}

/**
 * What did this charge buy?
 *
 * The Paystack Plan code is preferred over our own metadata because one code
 * names both the tier AND the cycle, and it is what Paystack actually billed —
 * metadata is only echoed back on the FIRST charge of a subscription, so
 * recurring charges have nothing else to go on.
 */
export function planFromCharge(meta: Json, plan: Json): ChargePlan | null {
  const code = str(plan.plan_code);
  if (code) {
    const found = platformPlanCodes().get(code);
    if (found) return fromCatalogue(found.tier, found.cycle);
    for (const legacy of LEGACY_PLANS) {
      if (process.env[legacy.env] === code) {
        return { tier: legacy.tier, cycle: legacy.cycle, months: cycleMonths(legacy.cycle), expectedKobo: legacy.amountKobo };
      }
    }
  }
  // Fallback for a first charge whose plan code we don't recognise (PAYSTACK_PLAN_*
  // drift): our own init metadata. A pre-cycle metadata blob carries no cycle, so
  // assume the default rather than dropping the charge.
  const metaPlan = str(meta.plan);
  if (metaPlan && isPlanTier(metaPlan)) {
    const metaCycle = str(meta.cycle);
    return fromCatalogue(metaPlan, metaCycle && isBillingCycle(metaCycle) ? metaCycle : DEFAULT_CYCLE);
  }
  return null;
}

// Paid-through date for a charge. A quarter buys three months and a year twelve
// — extending by one would cut a gym off inside a period it has already paid
// for, and extending by more would hand out access nobody paid for.
export function periodEndFor(paidAt: Date, months: number): Date {
  const d = new Date(paidAt);
  d.setMonth(d.getMonth() + months);
  return d;
}

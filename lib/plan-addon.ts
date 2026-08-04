// The optional private-trainer add-on on a membership plan.
//
// A gym can offer a private trainer alongside a plan and price it separately;
// the member decides at checkout whether to take it. The amount they owe is
// therefore plan price + (add-on price, if taken), and that sum is computed
// HERE and nowhere else — the picker previews it, the checkout initializes
// against it, and fulfillment re-derives it from the plan row to check what
// actually settled. A second copy of this arithmetic anywhere else is how a
// member gets charged one number and credited for another.
//
// Mirrors lib/plan-duration.ts, which plays the same single-source role for
// billing periods.

export type PlanAddon = {
  trainer_addon_enabled?: boolean | null;
  trainer_addon_price?: number | string | null;
};

// Ceiling on the add-on price. Prices arrive as free-typed numbers from the
// admin form, and numeric(12,2) would happily store a fat-fingered ₦150,000,000
// that then shows up on a member's checkout screen.
export const TRAINER_ADDON_MAX = 10_000_000;

// Does this plan offer a private trainer at all?
export function offersTrainer(p: PlanAddon | null | undefined): boolean {
  return Boolean(p?.trainer_addon_enabled);
}

// The add-on's price in naira: 0 when the plan doesn't offer it, and 0 when the
// gym bundles it free. Both are "nothing extra to pay", which is exactly how
// every caller wants to treat them. Non-finite/negative stored values clamp to
// 0 rather than subtracting from the plan price.
export function trainerAddonPrice(p: PlanAddon | null | undefined): number {
  if (!offersTrainer(p)) return 0;
  const raw = Number(p?.trainer_addon_price ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, TRAINER_ADDON_MAX);
}

// True only when taking the trainer actually costs the member more. Drives the
// "+₦x" affordance in the UI: a bundled-free trainer is a perk to advertise,
// not a surcharge to warn about.
export function trainerAddonCosts(p: PlanAddon | null | undefined): boolean {
  return trainerAddonPrice(p) > 0;
}

// What the member owes for one period. `withTrainer` is only honoured when the
// plan actually offers the add-on, so a tampered checkbox on a plan without one
// cannot inflate (or, with a bad stored price, deflate) the charge.
export function planTotalPrice(
  p: (PlanAddon & { price?: number | string | null }) | null | undefined,
  withTrainer: boolean,
): number {
  const base = Number(p?.price ?? 0);
  const safeBase = Number.isFinite(base) && base > 0 ? base : 0;
  return safeBase + (withTrainer ? trainerAddonPrice(p) : 0);
}

// Same total in kobo — the unit Paystack is initialized and settled in. Rounded
// once, at the boundary, so the naira and kobo views can never disagree.
export function planTotalKobo(
  p: (PlanAddon & { price?: number | string | null }) | null | undefined,
  withTrainer: boolean,
): number {
  return Math.round(planTotalPrice(p, withTrainer) * 100);
}

// Did the member ask for the trainer, and may they have it? Checkout metadata
// is attacker-shaped (it round-trips through Paystack), so the plan row decides
// whether the flag means anything. Shared by both fulfillment paths.
export function resolveTrainerOptIn(p: PlanAddon | null | undefined, requested: unknown): boolean {
  return offersTrainer(p) && requested === true;
}

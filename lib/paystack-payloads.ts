// Request bodies for Paystack's transaction endpoints.
//
// Pure and separate from lib/paystack.ts (which is `server-only` and therefore
// unimportable from a test) so the shape of what we send can be asserted
// without mocking fetch — the repo's test suite uses no mocking, so anything
// worth checking has to be reachable as a plain function.

export type SubscriptionInitBody = {
  email: string;
  amount: number;
  currency: 'NGN';
  plan: string;
  metadata: Record<string, unknown>;
  callback_url?: string;
};

/**
 * Body for POST /transaction/initialize when the transaction starts a
 * subscription.
 *
 * `amount` is REQUIRED by that endpoint even when `plan` is present — omitting
 * it is what produced "Invalid Amount Sent" on every plan checkout, platform
 * and member alike. Paystack then charges the PLAN's amount regardless of what
 * is sent here, so this field satisfies the API contract without becoming a
 * second source of truth for the price: a stale catalogue figure mis-displays,
 * it cannot mis-charge.
 *
 * Kobo, integer. Paystack rejects a fractional amount, and `price * 100` on a
 * numeric column is exactly where a fraction comes from, so it is rounded here
 * rather than at each call site.
 */
export function subscriptionInitBody(params: {
  email: string;
  planCode: string;
  amountKobo: number;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
}): SubscriptionInitBody {
  return {
    email: params.email,
    amount: Math.round(params.amountKobo),
    currency: 'NGN',
    plan: params.planCode,
    metadata: params.metadata,
    ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {}),
  };
}

/**
 * A gym's commission arrangement, as stored on its gyms row.
 *
 * `fixedNaira` is naira because that is what the column holds — see the
 * migration for why every money column in this schema is naira and kobo lives
 * only at this boundary.
 */
export type GymCommission = {
  mode: 'percentage' | 'fixed';
  /** Flat naira per payment. Only read in 'fixed' mode. */
  fixedNaira: number | null;
};

/**
 * Read a gym row's commission arrangement.
 *
 * One reader for every checkout door (web renew, WhatsApp, the app's
 * /api/app/renew) so a member cannot be charged a different commission
 * depending on which one they came through. Anything that isn't explicitly
 * 'fixed' is percentage — the mode column is NOT NULL with a percentage
 * default, but these rows also arrive through loosely-typed selects, and
 * "unrecognised" must fall back to the arrangement every gym already has.
 */
export function gymCommission(gym: {
  platform_commission_mode?: string | null;
  platform_commission_fixed_amount?: number | string | null;
} | null | undefined): GymCommission {
  const fixed = Number(gym?.platform_commission_fixed_amount ?? 0);
  return {
    mode: gym?.platform_commission_mode === 'fixed' ? 'fixed' : 'percentage',
    fixedNaira: Number.isFinite(fixed) ? fixed : null,
  };
}

/**
 * The flat `transaction_charge` (kobo) to send on /transaction/initialize, or
 * null when this charge carries none.
 *
 * Paystack's transaction_charge is a flat amount in kobo that overrides the
 * subaccount's percentage split for this one transaction and routes that much
 * to the main (platform) account. It is the only way to express "₦500 per
 * payment" — the subaccount itself can hold nothing but a percentage.
 *
 * CLAMPED to the charge MINUS the Paystack fee, never larger. A flat fee above
 * the amount being paid is nonsense arithmetic, and Paystack's own reaction to
 * it is not something to find out on a member's checkout: it either rejects the
 * initialize call — the member simply cannot pay, for a reason that is entirely
 * the platform's — or takes the whole charge.
 *
 * Clamping to the amount itself is not enough to avoid that, because
 * lib/paystack.ts sends `bearer: 'subaccount'`: the gym's share is what
 * Paystack's own fee comes out of, so a transaction_charge equal to (or within
 * a fee of) the amount leaves nothing to bear it. The ceiling therefore keeps
 * the fee's worth of headroom below the amount, and a flat fee that cannot fit
 * even that is dropped entirely rather than sent — the charge then falls back
 * to the subaccount's percentage, which is a real arrangement, instead of a
 * checkout that fails. A misconfigured flat fee shows up as a gym receiving a
 * little (or the old percentage) on small payments, which is visible and
 * fixable, rather than as checkouts that fail silently.
 *
 * Returns null in percentage mode, and for a zero/absent/non-finite flat
 * amount — sending `transaction_charge: 0` would be a real instruction to take
 * nothing, which is not the same as "this gym isn't on a flat deal".
 */
export function transactionChargeKobo(params: {
  commission: GymCommission | null | undefined;
  amountKobo: number;
}): number | null {
  const c = params.commission;
  if (!c || c.mode !== 'fixed') return null;
  const fixed = Number(c.fixedNaira);
  if (!Number.isFinite(fixed) || fixed <= 0) return null;
  // Paystack rejects a fractional amount, so round before clamping — a value
  // rounded up past the charge must still be caught by the clamp.
  const chargeKobo = Math.round(fixed * 100);
  const amountKobo = Math.round(params.amountKobo);
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) return null;
  const ceiling = amountKobo - paystackFeeKobo(amountKobo);
  // Nothing left once the fee is set aside — a payment that small cannot carry
  // a flat fee at all, so none is sent.
  if (ceiling <= 0) return null;
  return Math.min(chargeKobo, ceiling);
}

/**
 * Paystack's own fee on a local NGN charge, in kobo: 1.5% + ₦100, capped at
 * ₦2,000.
 *
 * Only ever used as HEADROOM — nothing is billed from it and it is not shown
 * anywhere — so it deliberately overstates rather than tracks the published
 * schedule exactly (the ₦100 is waived below ₦2,500, and is charged here
 * regardless). Overstating costs the platform a few naira of commission on a
 * tiny payment; understating costs the member their checkout.
 */
function paystackFeeKobo(amountKobo: number): number {
  return Math.min(Math.ceil(amountKobo * 0.015) + 10_000, 200_000);
}

/**
 * Is this a chargeable amount?
 *
 * Guards the call site so a missing price surfaces as our own message instead
 * of Paystack's "Invalid Amount Sent", which tells a gym owner nothing about
 * what to do next.
 */
export function isChargeableKobo(amountKobo: number | null | undefined): boolean {
  return typeof amountKobo === 'number' && Number.isFinite(amountKobo) && Math.round(amountKobo) > 0;
}

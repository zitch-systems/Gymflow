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
 * Is this a chargeable amount?
 *
 * Guards the call site so a missing price surfaces as our own message instead
 * of Paystack's "Invalid Amount Sent", which tells a gym owner nothing about
 * what to do next.
 */
export function isChargeableKobo(amountKobo: number | null | undefined): boolean {
  return typeof amountKobo === 'number' && Number.isFinite(amountKobo) && Math.round(amountKobo) > 0;
}

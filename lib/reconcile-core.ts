// Pure reconciliation matchers. Deliberately NOT 'server-only' so the vitest
// suite can exercise the matching rules without a Paystack account or DB.

// Charges that exist at Paystack but have no local payment row — the
// dropped-webhook case a daily sweep exists to catch. Paystack is the
// authoritative side here, so nothing is excluded: every successful charge on
// the account should have been fulfilled into payments or platform_payments.
export function missingLocally(paystackRefs: string[], localRefs: Set<string>): string[] {
  return paystackRefs.filter((r) => !localRefs.has(r));
}

// Local Paystack-referenced payments not found in the Paystack window — a
// data-integrity signal (should never happen for real charges). MANUAL-*
// references are cash/manual entries with no Paystack counterpart and must be
// skipped, or every front-desk cash payment would be flagged daily.
export function unknownAtPaystack(localRefs: string[], paystackRefs: Set<string>): string[] {
  return localRefs.filter((r) => !r.startsWith('MANUAL-') && !paystackRefs.has(r));
}

// Chunk helper for `.in()` queries — PostgREST URLs have practical length
// limits, so reference lists are matched in slices.
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type GymSplitFix = 'noop' | 'push_commission' | 'recreate' | 'retry_later';

// What the Paystack lookup told us about the stored subaccount code:
//  - 'found': it resolves — compare percentages.
//  - 'not_found': Paystack came back with a genuine 404 — it's actually gone.
//  - 'lookup_failed': anything else that kept us from getting a real answer —
//    timeout, dropped connection, 401/429/5xx, a JSON-parse failure. This is
//    NOT evidence the subaccount is gone, only that this one GET didn't land.
export type SubaccountLookupStatus = 'found' | 'not_found' | 'lookup_failed';

// Decide what a gym's Paystack subaccount needs, given the lookup's outcome
// and, when it resolved, the live percentage_charge Paystack reports for it.
// Pure so the branching — the actual bug this backs a fix for — is
// unit-testable without a Paystack account. See lib/reconcile.ts
// reconcileGymSplits, the sweep this drives.
//
// Recreating (minting a brand-new subaccount via createSubaccount + repointing
// the gym's stored code) is reserved for a confirmed 404 — a transient lookup
// failure must never be treated as "gone", or a Paystack blip during the
// sweep mints duplicate subaccounts for every candidate gym in the run and
// orphans their real ones. A failed lookup instead reports 'retry_later' so
// the caller records the transient error and leaves the gym for the next run,
// the same posture reconcilePayouts already takes on a failed getTransfer.
//
// FIXED-MODE GYMS ARE CHECKED THE SAME WAY, on purpose, and this function needs
// no notion of the mode at all. A gym on a flat per-payment fee still has
// gyms.platform_commission_pct maintained as the subaccount's fallback rate —
// the flat amount travels per-charge as Paystack's transaction_charge, and the
// subaccount has nowhere to hold it (see lib/paystack.ts initTransaction). So
// "does the live percentage_charge match our stored percentage" remains exactly
// the right question for every gym. The two alternatives are both wrong:
// skipping fixed-mode gyms would let their fallback rot unnoticed — precisely
// the rate a charge falls back to when something goes wrong — and comparing the
// live percentage against a flat naira figure would flag every fixed-mode gym
// as drifted on every run, forever.
export function planGymSplitFix(params: {
  subaccountStatus: SubaccountLookupStatus;
  livePct: number | null;
  dbPct: number;
}): GymSplitFix {
  if (params.subaccountStatus === 'lookup_failed') return 'retry_later';
  if (params.subaccountStatus === 'not_found') return 'recreate';
  if (params.livePct == null || !commissionPctMatches(params.livePct, params.dbPct)) return 'push_commission';
  return 'noop';
}

// Paystack can echo percentage_charge with float noise (20 stored, 19.999999
// read back) — compare to 2dp, matching gyms.platform_commission_pct's
// numeric(5,2) precision, so that noise alone never triggers a needless push.
export function commissionPctMatches(livePct: number, dbPct: number): boolean {
  return Math.round(livePct * 100) === Math.round(dbPct * 100);
}

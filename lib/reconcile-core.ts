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

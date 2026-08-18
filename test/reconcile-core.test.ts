import { describe, expect, it } from 'vitest';
import { missingLocally, unknownAtPaystack, chunk, planGymSplitFix, commissionPctMatches } from '@/lib/reconcile-core';

// Matching rules for the daily Paystack ↔ DB reconciliation sweep
// (lib/reconcile.ts). The sweep's whole job is these set differences — get
// them wrong and dropped-webhook charges stay invisible or every cash payment
// gets flagged daily.

describe('missingLocally', () => {
  it('flags Paystack charges with no local payment row', () => {
    const local = new Set(['ref_a', 'ref_b']);
    expect(missingLocally(['ref_a', 'ref_b', 'ref_c'], local)).toEqual(['ref_c']);
  });

  it('returns empty when everything reconciles', () => {
    expect(missingLocally(['r1'], new Set(['r1']))).toEqual([]);
    expect(missingLocally([], new Set())).toEqual([]);
  });
});

describe('unknownAtPaystack', () => {
  it('flags local references absent from the Paystack window', () => {
    expect(unknownAtPaystack(['r1', 'r2'], new Set(['r1']))).toEqual(['r2']);
  });

  it('skips MANUAL-* references — cash entries have no Paystack counterpart', () => {
    const local = ['MANUAL-1700000000-abc', 'r1'];
    expect(unknownAtPaystack(local, new Set())).toEqual(['r1']);
  });

  it('returns empty when all real references are known', () => {
    expect(unknownAtPaystack(['MANUAL-x', 'r1'], new Set(['r1']))).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits into fixed-size slices with a short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('handles empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('one slice when the list fits', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
});

// Gym Paystack-split reconciliation (lib/reconcile.ts reconcileGymSplits) —
// the fix for a gym whose stored paystack_subaccount_code is stale/invalid at
// Paystack, or whose live percentage_charge drifted from platform_commission_pct.

describe('planGymSplitFix', () => {
  it('recreates when Paystack confirms the stored subaccount code is genuinely gone (404)', () => {
    expect(planGymSplitFix({ subaccountStatus: 'not_found', livePct: null, dbPct: 20 })).toBe('recreate');
  });

  it('retries later instead of recreating when the lookup itself failed (timeout/401/429/5xx/bad JSON)', () => {
    // The whole point of the fix: a transient lookup failure must NEVER be
    // treated as "gone", or a Paystack blip mints duplicate subaccounts for
    // every candidate gym in the run. See lib/paystack.ts getSubaccount.
    expect(planGymSplitFix({ subaccountStatus: 'lookup_failed', livePct: null, dbPct: 20 })).toBe('retry_later');
  });

  it('pushes the commission when the subaccount resolves but the rate drifted', () => {
    expect(planGymSplitFix({ subaccountStatus: 'found', livePct: 5, dbPct: 20 })).toBe('push_commission');
  });

  it('is a no-op when the subaccount resolves and the rate already matches', () => {
    expect(planGymSplitFix({ subaccountStatus: 'found', livePct: 20, dbPct: 20 })).toBe('noop');
  });

  it('treats a missing live percentage as a mismatch, not a match', () => {
    expect(planGymSplitFix({ subaccountStatus: 'found', livePct: null, dbPct: 20 })).toBe('push_commission');
  });
});

describe('commissionPctMatches', () => {
  it('matches exact values', () => {
    expect(commissionPctMatches(20, 20)).toBe(true);
  });

  it('tolerates float noise Paystack can echo back, to 2dp precision', () => {
    expect(commissionPctMatches(19.999999, 20)).toBe(true);
  });

  it('flags a real difference', () => {
    expect(commissionPctMatches(5, 20)).toBe(false);
  });

  it('does not tolerate a genuine 2dp difference', () => {
    expect(commissionPctMatches(20.01, 20)).toBe(false);
  });
});

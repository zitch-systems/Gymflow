import { describe, expect, it } from 'vitest';
import { missingLocally, unknownAtPaystack, chunk } from '@/lib/reconcile-core';

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

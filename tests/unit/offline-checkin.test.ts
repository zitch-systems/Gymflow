import { describe, it, expect } from 'vitest';
import { sanitizeOccurredAt, MAX_OFFLINE_CHECKIN_AGE_MS, CLOCK_SKEW_TOLERANCE_MS } from '@/lib/offline-checkin';

// The server trust boundary for replayed offline check-ins. A queued
// check-in carries its original arrival time so the visit log is accurate,
// but the value is client-supplied and must be validated before it touches
// check_ins.checked_in_at.
describe('sanitizeOccurredAt', () => {
  const now = Date.parse('2026-05-30T12:00:00.000Z');

  it('passes a recent past timestamp through, normalized to ISO', () => {
    const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
    expect(sanitizeOccurredAt(tenMinAgo, now)).toBe(tenMinAgo);
  });

  it('accepts the boundary just inside the max age', () => {
    const justInside = new Date(now - MAX_OFFLINE_CHECKIN_AGE_MS + 1000).toISOString();
    expect(sanitizeOccurredAt(justInside, now)).toBe(justInside);
  });

  it('rejects a timestamp older than the max age (too stale to be "today")', () => {
    const tooOld = new Date(now - MAX_OFFLINE_CHECKIN_AGE_MS - 1000).toISOString();
    expect(sanitizeOccurredAt(tooOld, now)).toBeNull();
  });

  it('rejects a future timestamp beyond clock-skew tolerance (forged/forward clock)', () => {
    const future = new Date(now + CLOCK_SKEW_TOLERANCE_MS + 1000).toISOString();
    expect(sanitizeOccurredAt(future, now)).toBeNull();
  });

  it('tolerates a small forward clock skew', () => {
    const slightlyAhead = new Date(now + CLOCK_SKEW_TOLERANCE_MS - 1000).toISOString();
    expect(sanitizeOccurredAt(slightlyAhead, now)).toBe(slightlyAhead);
  });

  it('returns null for null / empty / unparseable input', () => {
    expect(sanitizeOccurredAt(null, now)).toBeNull();
    expect(sanitizeOccurredAt(undefined, now)).toBeNull();
    expect(sanitizeOccurredAt('', now)).toBeNull();
    expect(sanitizeOccurredAt('not-a-date', now)).toBeNull();
  });
});

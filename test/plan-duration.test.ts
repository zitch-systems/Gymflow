import { describe, expect, it } from 'vitest';
import { coverageEnd, renewalBase, projectRenewalEnd } from '@/lib/plan-duration';

// Paid membership dates are inclusive in storage. A new allocation beginning
// on `start` covers [start, calendar anniversary), so its stored end_date is
// anniversary - 1 day.

const NOW = new Date('2026-03-15T00:00:00Z');
const DAILY = { duration_days: 1, duration_months: null };
const WEEKLY = { duration_days: 7, duration_months: null };
const MONTHLY = { duration_days: null, duration_months: 1 };
const YEARLY = { duration_days: null, duration_months: 12 };
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('coverageEnd', () => {
  it('makes an N-day term cover exactly N calendar dates', () => {
    const start = new Date('2026-04-02T00:00:00Z');
    expect(iso(coverageEnd(start, DAILY))).toBe('2026-04-02');
    expect(iso(coverageEnd(start, WEEKLY))).toBe('2026-04-08');
  });

  it('uses a clamped calendar anniversary in a non-leap February', () => {
    expect(iso(coverageEnd(new Date('2027-01-31T00:00:00Z'), MONTHLY))).toBe('2027-02-27');
  });

  it('uses a clamped calendar anniversary in a leap February', () => {
    expect(iso(coverageEnd(new Date('2028-01-31T00:00:00Z'), MONTHLY))).toBe('2028-02-28');
  });

  it('uses UTC calendar arithmetic and is unaffected by an offset or DST boundary', () => {
    const start = new Date('2026-03-08T00:00:00Z');
    expect(iso(coverageEnd(start, WEEKLY))).toBe('2026-03-14');
    expect(coverageEnd(start, WEEKLY).getUTCHours()).toBe(0);
    expect(iso(coverageEnd(new Date('2026-09-30T23:30:00Z'), DAILY))).toBe('2026-10-01');
  });
});

describe('renewalBase', () => {
  it('starts after the inclusive end of a current or future period', () => {
    expect(iso(renewalBase('2026-04-01', NOW))).toBe('2026-04-02');
    expect(iso(renewalBase('2026-03-15', NOW))).toBe('2026-03-16');
  });

  it('starts today when the previous period expired or does not exist', () => {
    expect(iso(renewalBase('2026-03-14', NOW))).toBe('2026-03-15');
    expect(iso(renewalBase(null, NOW))).toBe('2026-03-15');
    expect(iso(renewalBase(undefined, NOW))).toBe('2026-03-15');
  });

  it('uses the WAT day at the UTC rollover and stays independent of DST', () => {
    const watTomorrow = new Date('2026-09-30T23:30:00Z');
    expect(iso(renewalBase(null, watTomorrow))).toBe('2026-10-01');
    expect(iso(renewalBase('2026-10-01', watTomorrow))).toBe('2026-10-02');
  });
});

describe('projectRenewalEnd', () => {
  const activeEnd = '2026-04-01';

  it('stacks daily, weekly and yearly terms without shortening existing coverage', () => {
    expect(iso(projectRenewalEnd(activeEnd, DAILY, NOW))).toBe('2026-04-02');
    expect(iso(projectRenewalEnd(activeEnd, WEEKLY, NOW))).toBe('2026-04-08');
    expect(iso(projectRenewalEnd(activeEnd, YEARLY, NOW))).toBe('2027-04-01');

    for (const period of [DAILY, WEEKLY, MONTHLY, YEARLY]) {
      expect(projectRenewalEnd(activeEnd, period, NOW).getTime())
        .toBeGreaterThan(new Date(`${activeEnd}T00:00:00Z`).getTime());
    }
  });

  it('starts an expired member fresh on the WAT day, including a one-day plan', () => {
    const now = new Date('2026-09-30T23:30:00Z');
    expect(iso(projectRenewalEnd(null, DAILY, now))).toBe('2026-10-01');
    expect(iso(projectRenewalEnd('2026-09-30', DAILY, now))).toBe('2026-10-01');
  });

  it('does not shorten a future period when the renewal starts at month end', () => {
    expect(iso(projectRenewalEnd('2027-01-30', MONTHLY, NOW))).toBe('2027-02-27');
  });
});

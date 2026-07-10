import { describe, expect, it } from 'vitest';
import { renewalBase, projectRenewalEnd, extendDate } from '@/lib/plan-duration';

// Pure unit tests for the renewal-stacking rule: buying while a subscription is
// still active must extend the NEXT period (stack onto the current end date),
// never overwrite the period the member is already inside.

const NOW = new Date('2026-03-15T00:00:00Z');
const DAY = 86_400_000;
const DAILY = { duration_days: 1, duration_months: null };
const WEEKLY = { duration_days: 7, duration_months: null };
const MONTHLY = { duration_days: null, duration_months: 1 };
const YEARLY = { duration_days: null, duration_months: 12 };

describe('renewalBase', () => {
  it('returns the current end date when it is still in the future (stack next period)', () => {
    const end = '2026-04-01';
    expect(renewalBase(end, NOW).toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('returns now when the subscription has already lapsed', () => {
    expect(renewalBase('2026-03-01', NOW).getTime()).toBe(NOW.getTime());
  });

  it('returns now when there is no subscription', () => {
    expect(renewalBase(null, NOW).getTime()).toBe(NOW.getTime());
    expect(renewalBase(undefined, NOW).getTime()).toBe(NOW.getTime());
  });

  it('does not treat an end date exactly equal to now as future', () => {
    expect(renewalBase(NOW, NOW).getTime()).toBe(NOW.getTime());
  });
});

describe('projectRenewalEnd — active member buys the next period', () => {
  const activeEnd = '2026-04-01'; // 17 days out from NOW

  it('daily re-purchase lands one day after the current period ends, not tomorrow', () => {
    const end = projectRenewalEnd(activeEnd, DAILY, NOW);
    expect(end.getTime()).toBe(new Date('2026-04-02T00:00:00Z').getTime());
  });

  it('switching to weekly stacks 7 days onto the current end', () => {
    const end = projectRenewalEnd(activeEnd, WEEKLY, NOW);
    expect(end.getTime()).toBe(new Date('2026-04-08T00:00:00Z').getTime());
  });

  it('switching to yearly stacks 12 months onto the current end', () => {
    const end = projectRenewalEnd(activeEnd, YEARLY, NOW);
    expect(end.toISOString().slice(0, 10)).toBe('2027-04-01');
  });

  it('never shortens or overwrites the current period', () => {
    const end = projectRenewalEnd(activeEnd, MONTHLY, NOW);
    expect(end.getTime()).toBeGreaterThan(new Date(activeEnd).getTime());
  });
});

describe('projectRenewalEnd — lapsed member starts fresh from today', () => {
  it('daily plan covers today + 1 day', () => {
    const end = projectRenewalEnd(null, DAILY, NOW);
    expect(end.getTime()).toBe(NOW.getTime() + DAY);
  });

  it('matches extendDate(now) when there is no active period', () => {
    expect(projectRenewalEnd('2026-03-01', MONTHLY, NOW).getTime())
      .toBe(extendDate(NOW, MONTHLY).getTime());
  });
});

import { describe, it, expect } from 'vitest';
import { addMonths } from '@/lib/dates';

const iso = (d: Date) => d.toISOString().split('T')[0];

describe('addMonths', () => {
  it('adds a plain month without overflow', () => {
    expect(iso(addMonths(new Date('2026-03-15T00:00:00Z'), 1))).toBe('2026-04-15');
  });

  it('clamps Jan 31 + 1 month to Feb 28 in a non-leap year (no Mar 3 rollover)', () => {
    expect(iso(addMonths(new Date('2026-01-31T00:00:00Z'), 1))).toBe('2026-02-28');
  });

  it('clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
    expect(iso(addMonths(new Date('2028-01-31T00:00:00Z'), 1))).toBe('2028-02-29');
  });

  it('clamps Jan 31 + 1 month, then a clean month for Mar 31 + 1 -> Apr 30', () => {
    expect(iso(addMonths(new Date('2026-03-31T00:00:00Z'), 1))).toBe('2026-04-30');
  });

  it('rolls the year over for +12 months', () => {
    expect(iso(addMonths(new Date('2026-06-10T00:00:00Z'), 12))).toBe('2027-06-10');
  });

  it('handles multi-month spans with clamping (Jan 31 + 13 months -> Feb 28 next year)', () => {
    expect(iso(addMonths(new Date('2026-01-31T00:00:00Z'), 13))).toBe('2027-02-28');
  });

  it('does not mutate its input', () => {
    const d = new Date('2026-01-31T00:00:00Z');
    addMonths(d, 1);
    expect(iso(d)).toBe('2026-01-31');
  });

  it('preserves the time-of-day component', () => {
    const out = addMonths(new Date('2026-03-15T09:30:00Z'), 2);
    expect(out.toISOString()).toBe('2026-05-15T09:30:00.000Z');
  });
});

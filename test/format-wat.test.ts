import { describe, expect, it } from 'vitest';
import { watDateISO, watDayStartUtc, watMonthStartISO } from '@/lib/format';

// Servers run in UTC; gyms run in WAT (UTC+1). The hour after WAT midnight is
// still the previous UTC day, which is where "today" and "this month" went wrong.
describe('WAT calendar helpers', () => {
  it('puts 00:30 WAT on the new WAT day and month', () => {
    const justAfterMidnightWat = new Date('2026-08-31T23:30:00Z');
    expect(watDateISO(justAfterMidnightWat)).toBe('2026-09-01');
    expect(watMonthStartISO(justAfterMidnightWat)).toBe('2026-09-01');
  });

  it('keeps 23:30 WAT in the current month', () => {
    expect(watMonthStartISO(new Date('2026-09-30T22:30:00Z'))).toBe('2026-09-01');
  });

  it('turns a WAT month start into the matching UTC instant', () => {
    expect(watDayStartUtc(watMonthStartISO(new Date('2026-09-15T12:00:00Z')))).toBe('2026-08-31T23:00:00.000Z');
  });
});

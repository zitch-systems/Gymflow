import { describe, expect, it } from 'vitest';
import { openDaysPerWeek, openStateFor, todayHoursLabel, type HoursRow } from '@/lib/opening-hours';

// "Open now · closes 9:00 PM" is the most load-bearing sentence on a gym's
// landing page — someone deciding whether to get in a car. Wrong is worse than
// absent, so every boundary is pinned here.

// 2026-07-29 is a Wednesday (day 3).
const wed = (h: number, m = 0) => new Date(2026, 6, 29, h, m);

const row = (day: number, open: string | null, close: string | null, closed = false): HoursRow => ({
  day_of_week: day, open_time: open, close_time: close, is_closed: closed, session: 'all',
});

const WEEKDAYS = [1, 2, 3, 4, 5].map((d) => row(d, '05:00', '21:00'));

describe('openStateFor', () => {
  it('is open inside the range', () => {
    expect(openStateFor(WEEKDAYS, wed(9))).toEqual({ open: true, label: 'Open now', detail: 'closes 9:00 PM' });
  });

  it('is open at the opening minute and closed at the closing minute', () => {
    // Half-open interval: a gym that closes at 21:00 is not open at 21:00.
    expect(openStateFor(WEEKDAYS, wed(5, 0))?.open).toBe(true);
    expect(openStateFor(WEEKDAYS, wed(20, 59))?.open).toBe(true);
    expect(openStateFor(WEEKDAYS, wed(21, 0))?.open).toBe(false);
  });

  it('points at the next opening later the same day', () => {
    expect(openStateFor(WEEKDAYS, wed(4))).toEqual({ open: false, label: 'Closed', detail: 'opens 5:00 AM today' });
  });

  it('rolls to tomorrow after the last session', () => {
    expect(openStateFor(WEEKDAYS, wed(22))).toEqual({ open: false, label: 'Closed', detail: 'opens 5:00 AM tomorrow' });
  });

  it('names the day when the next opening is further out', () => {
    // Open Mondays only; from Wednesday night the next opening is Monday.
    expect(openStateFor([row(1, '06:00', '20:00')], wed(22))).toEqual({
      open: false, label: 'Closed', detail: 'opens 6:00 AM Monday',
    });
  });

  it('handles split sessions on one day', () => {
    const split = [row(3, '05:00', '12:00'), row(3, '17:00', '21:00')];
    expect(openStateFor(split, wed(6))).toMatchObject({ open: true, detail: 'closes 12:00 PM' });
    expect(openStateFor(split, wed(14))).toMatchObject({ open: false, detail: 'opens 5:00 PM today' });
    expect(openStateFor(split, wed(18))).toMatchObject({ open: true, detail: 'closes 9:00 PM' });
  });

  it('handles a range that runs past midnight, from both ends', () => {
    const overnight = [row(3, '22:00', '02:00')]; // Wednesday 10pm → Thursday 2am
    expect(openStateFor(overnight, wed(23))?.open).toBe(true);
    // 1am on Thursday is still inside Wednesday's range.
    expect(openStateFor(overnight, new Date(2026, 6, 30, 1))?.open).toBe(true);
    // 3am Thursday is not.
    expect(openStateFor(overnight, new Date(2026, 6, 30, 3))?.open).toBe(false);
  });

  it('ignores days explicitly marked closed', () => {
    expect(openStateFor([row(3, '05:00', '21:00', true)], wed(9))).toEqual({
      open: false, label: 'Closed', detail: null,
    });
  });

  it('returns null rather than guessing when there are no usable hours', () => {
    // No badge beats a confident "Closed" derived from missing data.
    expect(openStateFor([], wed(9))).toBeNull();
    expect(openStateFor([row(3, null, null)], wed(9))).toBeNull();
    expect(openStateFor([row(3, 'not-a-time', '21:00')], wed(9))).toBeNull();
  });

  it('survives malformed times without throwing', () => {
    expect(openStateFor([row(3, '25:00', '21:00'), row(3, '05:00', '21:00')], wed(9))?.open).toBe(true);
  });
});

describe('todayHoursLabel', () => {
  it('lists every session for today, in order', () => {
    const split = [row(3, '17:00', '21:00'), row(3, '05:00', '12:00')];
    expect(todayHoursLabel(split, wed(9))).toBe('5:00 AM – 12:00 PM · 5:00 PM – 9:00 PM');
  });

  it('is null on a day with nothing published', () => {
    expect(todayHoursLabel([row(1, '05:00', '21:00')], wed(9))).toBeNull();
  });
});

describe('openDaysPerWeek', () => {
  it('counts distinct open days, not rows', () => {
    expect(openDaysPerWeek([...WEEKDAYS, row(3, '17:00', '21:00')])).toBe(5);
    expect(openDaysPerWeek([])).toBe(0);
  });
});

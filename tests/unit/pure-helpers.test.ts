import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeActivity, findNextClass, dayKey, type ScheduleRow } from '@/lib/activity';
import { daysFromNowDate, daysAgoDate, todayDate } from '@/lib/dates';
import { fmtNaira, daysLeft, relativeTime } from '@/lib/format';

// Pure helpers — no Supabase, no mocking. activity.ts carries the trickiest
// logic (streak walk-back, next-class scheduling), so it gets the most cases.
// Every function accepts an injectable `now`, so dates are deterministic.

const utc = (s: string) => new Date(s + 'T12:00:00Z'); // noon UTC avoids tz edge

describe('activity.dayKey', () => {
  it('buckets a timestamp to its UTC calendar date', () => {
    expect(dayKey('2026-05-29T23:30:00Z')).toBe('2026-05-29');
    expect(dayKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});

describe('activity.computeActivity', () => {
  const NOW = utc('2026-05-29'); // a Friday

  it('returns an all-empty summary for no check-ins', () => {
    const a = computeActivity([], NOW);
    expect(a.totalVisits).toBe(0);
    expect(a.visitsThisMonth).toBe(0);
    expect(a.currentStreak).toBe(0);
    expect(a.lastVisit).toBeNull();
    expect(a.strip).toHaveLength(14); // always a 14-day strip
    expect(a.strip.every((d) => d.active === false)).toBe(true);
  });

  it('drops null check-ins and counts the rest', () => {
    const a = computeActivity([null, '2026-05-29T08:00:00Z', null], NOW);
    expect(a.totalVisits).toBe(2 - 1); // one null dropped, one real stamp
  });

  it('counts only this-month visits in visitsThisMonth', () => {
    const a = computeActivity([
      '2026-05-01T08:00:00Z',
      '2026-05-29T08:00:00Z',
      '2026-04-30T08:00:00Z', // previous month — excluded
    ], NOW);
    expect(a.visitsThisMonth).toBe(2);
    expect(a.totalVisits).toBe(3);
  });

  it('counts consecutive days ending today as the current streak', () => {
    const a = computeActivity([
      '2026-05-27T08:00:00Z',
      '2026-05-28T08:00:00Z',
      '2026-05-29T08:00:00Z',
    ], NOW);
    expect(a.currentStreak).toBe(3);
  });

  it('keeps the streak alive when today is not yet checked in but yesterday was', () => {
    // anchor allows today OR yesterday, so a member who hasn't been in yet
    // today doesn't lose their streak.
    const a = computeActivity([
      '2026-05-27T08:00:00Z',
      '2026-05-28T08:00:00Z',
    ], NOW);
    expect(a.currentStreak).toBe(2);
  });

  it('breaks the streak when there is a gap (neither today nor yesterday)', () => {
    const a = computeActivity([
      '2026-05-25T08:00:00Z',
      '2026-05-26T08:00:00Z',
    ], NOW); // gap on 27 & 28 → streak anchor (29/28) is empty
    expect(a.currentStreak).toBe(0);
  });

  it('counts multiple check-ins on the same day as one streak day', () => {
    const a = computeActivity([
      '2026-05-29T08:00:00Z',
      '2026-05-29T18:00:00Z',
      '2026-05-28T08:00:00Z',
    ], NOW);
    expect(a.currentStreak).toBe(2);     // two distinct days
    expect(a.totalVisits).toBe(3);        // but three raw visits
  });

  it('marks active days in the 14-day strip and sorts oldest→newest', () => {
    const a = computeActivity(['2026-05-29T08:00:00Z', '2026-05-23T08:00:00Z'], NOW);
    expect(a.strip).toHaveLength(14);
    expect(a.strip[0].date < a.strip[13].date).toBe(true); // oldest first
    expect(a.strip.find((d) => d.date === '2026-05-29')!.active).toBe(true);
    expect(a.strip.find((d) => d.date === '2026-05-23')!.active).toBe(true);
    expect(a.strip.find((d) => d.date === '2026-05-24')!.active).toBe(false);
  });

  it('reports the latest stamp as lastVisit regardless of input order', () => {
    const a = computeActivity([
      '2026-05-20T08:00:00Z',
      '2026-05-29T08:00:00Z',
      '2026-05-25T08:00:00Z',
    ], NOW);
    expect(a.lastVisit).toBe('2026-05-29T08:00:00Z');
  });
});

describe('activity.findNextClass', () => {
  // 2026-05-29 is a Friday (UTC getUTCDay() === 5).
  const FRI_0900 = new Date('2026-05-29T09:00:00Z');
  const rows: ScheduleRow[] = [
    { day_of_week: 5, start_time: '18:00:00', end_time: '19:00:00', room: 'A', classes: { name: 'Evening HIIT', instructor: 'Ada' } },
    { day_of_week: 1, start_time: '07:00:00', end_time: '08:00:00', room: 'B', classes: { name: 'Monday Spin', instructor: 'Bem' } },
  ];

  it('returns null for an empty schedule', () => {
    expect(findNextClass([], FRI_0900)).toBeNull();
  });

  it('picks today\'s later class as next when it has not started yet', () => {
    const next = findNextClass(rows, FRI_0900);
    expect(next?.name).toBe('Evening HIIT');
    expect(next?.dayLabel).toBe('Today');
    expect(next?.isToday).toBe(true);
    expect(next?.start).toBe('18:00'); // HH:MM, seconds trimmed
  });

  it('rolls a class that already started today to next week, choosing the soonest other day', () => {
    const afterHiit = new Date('2026-05-29T20:00:00Z'); // Fri 8pm, HIIT done
    const next = findNextClass(rows, afterHiit);
    // Monday Spin (offset +3) beats Evening HIIT (rolled to +7).
    expect(next?.name).toBe('Monday Spin');
    expect(next?.isToday).toBe(false);
  });

  it('labels an offset of 1 as Tomorrow', () => {
    const thu = new Date('2026-05-28T09:00:00Z'); // Thursday → Friday HIIT is +1
    const next = findNextClass(rows, thu);
    expect(next?.dayLabel).toBe('Tomorrow');
  });

  it('falls back to defaults when class metadata is missing', () => {
    const bare: ScheduleRow[] = [{ day_of_week: 5, start_time: '18:00:00', end_time: '19:00:00', room: null, classes: null }];
    const next = findNextClass(bare, FRI_0900);
    expect(next?.name).toBe('Class');
    expect(next?.instructor).toBeNull();
    expect(next?.room).toBeNull();
  });
});

describe('dates helpers', () => {
  // Pin the clock so day math is deterministic.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-29T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('todayDate is YYYY-MM-DD with no time component', () => {
    expect(todayDate()).toBe('2026-05-29');
  });

  it('daysFromNowDate / daysAgoDate move the calendar date correctly', () => {
    expect(daysFromNowDate(3)).toBe('2026-06-01');
    expect(daysAgoDate(29)).toBe('2026-04-30');
  });
});

describe('format helpers', () => {
  it('fmtNaira renders a thousands-separated amount, dash for null', () => {
    expect(fmtNaira(15000)).toBe('₦15,000');
    expect(fmtNaira(0)).toBe('₦0');
    expect(fmtNaira(null)).toBe('—');
    expect(fmtNaira(undefined)).toBe('—');
  });

  it('daysLeft clamps to zero for past dates and counts future days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
    expect(daysLeft('2026-06-08T12:00:00Z')).toBe(10);
    expect(daysLeft('2026-05-01T12:00:00Z')).toBe(0); // past → clamped
    expect(daysLeft(null)).toBe(0);
    vi.useRealTimers();
  });

  it('relativeTime buckets recent timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
    expect(relativeTime(new Date('2026-05-29T11:59:30Z'))).toBe('just now'); // <60s
    expect(relativeTime(new Date('2026-05-29T11:30:00Z'))).toBe('30m ago');
    expect(relativeTime(new Date('2026-05-29T09:00:00Z'))).toBe('3h ago');
    expect(relativeTime(new Date('2026-05-27T12:00:00Z'))).toBe('2d ago');
    expect(relativeTime(null)).toBe('');
    vi.useRealTimers();
  });
});

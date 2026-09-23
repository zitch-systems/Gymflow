import { describe, expect, it } from 'vitest';
import { isSameWatDate, nextOccurrenceDate, rosterSessionDate, shiftWeeks } from '@/lib/class-dates';

// The bug this replaces: a member booked a 7:00 AM class in the afternoon. The
// booking action rolled to next week (right — the class had run), the detail
// page did not (wrong), so the page looked for a booking dated today, found
// none, and told an already-booked member to book.
//
// Callers pass watNow(), a Date shifted +1h whose getUTC* fields read as WAT
// wall-clock, so these fixtures are built the same way.
const wat = (iso: string) => new Date(`${iso}Z`);

// 2026-07-29 is a Wednesday (dow 3).
const WED_5PM = wat('2026-07-29T17:40:00');
const WED_6AM = wat('2026-07-29T06:00:00');

describe('nextOccurrenceDate', () => {
  it('is today when the slot is later today', () => {
    expect(nextOccurrenceDate(3, '07:00', WED_6AM)).toBe('2026-07-29');
  });

  it('rolls a week when today’s start time has passed — the reported bug', () => {
    expect(nextOccurrenceDate(3, '07:00', WED_5PM)).toBe('2026-08-05');
  });

  it('treats a class starting exactly now as gone', () => {
    // You don't book the class you're standing outside of.
    expect(nextOccurrenceDate(3, '17:40', WED_5PM)).toBe('2026-08-05');
    expect(nextOccurrenceDate(3, '17:41', WED_5PM)).toBe('2026-07-29');
  });

  it('counts forward to a later weekday this week', () => {
    expect(nextOccurrenceDate(5, '07:00', WED_5PM)).toBe('2026-07-31'); // Friday
  });

  it('wraps to next week for a weekday already past', () => {
    expect(nextOccurrenceDate(1, '07:00', WED_5PM)).toBe('2026-08-03'); // Monday
  });

  it('handles Sunday, where naive modulo arithmetic goes negative', () => {
    expect(nextOccurrenceDate(0, '09:00', WED_5PM)).toBe('2026-08-02');
  });

  it('crosses a month boundary correctly', () => {
    // Wednesday 29 July + 7 days lands in August.
    expect(nextOccurrenceDate(3, '06:00', WED_5PM)).toBe('2026-08-05');
  });

  it('ignores the time check when no start time is known', () => {
    expect(nextOccurrenceDate(3, null, WED_5PM)).toBe('2026-07-29');
    expect(nextOccurrenceDate(3, '', WED_5PM)).toBe('2026-07-29');
  });

  it('survives a malformed start time instead of skipping a week silently', () => {
    // NaN minutes must not read as "already passed".
    expect(nextOccurrenceDate(3, 'not-a-time', WED_6AM)).toBe('2026-07-29');
  });

  it('agrees with itself either side of midnight WAT', () => {
    const justBeforeMidnight = wat('2026-07-29T23:59:00');
    const justAfterMidnight = wat('2026-07-30T00:01:00');
    // 23:59 Wednesday: Thursday's 07:00 class is tomorrow.
    expect(nextOccurrenceDate(4, '07:00', justBeforeMidnight)).toBe('2026-07-30');
    // Two minutes later it is that same date, now "today".
    expect(nextOccurrenceDate(4, '07:00', justAfterMidnight)).toBe('2026-07-30');
  });
});

describe('isSameWatDate', () => {
  it('matches the label to the date actually booked', () => {
    expect(isSameWatDate('2026-07-29', WED_5PM)).toBe(true);
    expect(isSameWatDate('2026-08-05', WED_5PM)).toBe(false);
  });
});

// The admin roster once counted every booking the weekly slot had ever taken
// against one session's capacity ("57/20 booked"). It now shows one session.
describe('rosterSessionDate', () => {
  it('stays on today after the class has started, so attendance can be marked', () => {
    expect(rosterSessionDate(3, null, WED_5PM)).toBe('2026-07-29');
  });

  it('is the next session when the slot does not run today', () => {
    expect(rosterSessionDate(5, null, WED_5PM)).toBe('2026-07-31');
  });

  it('honours a requested date on the slot’s weekday, past or future', () => {
    expect(rosterSessionDate(3, '2026-07-22', WED_5PM)).toBe('2026-07-22');
    expect(rosterSessionDate(3, '2026-08-12', WED_5PM)).toBe('2026-08-12');
  });

  it('ignores a requested date that is malformed, impossible, or on another weekday', () => {
    expect(rosterSessionDate(3, 'garbage', WED_5PM)).toBe('2026-07-29');
    expect(rosterSessionDate(3, '2026-02-31', WED_5PM)).toBe('2026-07-29');
    expect(rosterSessionDate(3, '2026-07-30', WED_5PM)).toBe('2026-07-29');
  });
});

describe('shiftWeeks', () => {
  it('moves across month and year boundaries', () => {
    expect(shiftWeeks('2026-07-29', 1)).toBe('2026-08-05');
    expect(shiftWeeks('2026-01-02', -1)).toBe('2025-12-26');
  });
});

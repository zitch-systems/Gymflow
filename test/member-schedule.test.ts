import { describe, expect, it } from 'vitest';
import { isUpcomingMemberBooking, memberScheduleDays, memberSessionKey } from '@/lib/member-schedule';

describe('member timetable dates', () => {
  const saturday = new Date('2026-10-17T21:00:00Z'); // WAT-shifted wall clock.

  it('shows the upcoming Monday, not a past date whose booking silently moves a week', () => {
    const days = memberScheduleDays(saturday, '1');
    expect(days.map((day) => day.date)).toEqual([
      '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20',
      '2026-10-21', '2026-10-22', '2026-10-23',
    ]);
    expect(days.find((day) => day.selected)?.date).toBe('2026-10-19');
  });

  it('rejects fractional, infinite and out-of-range weekday parameters', () => {
    for (const requested of ['1.5', 'Infinity', '-1', '8', '', 'bad']) {
      expect(memberScheduleDays(saturday, requested).find((day) => day.selected)?.dow).toBe(6);
    }
  });

  it('handles year boundaries and distinguishes occurrences of the same weekly class', () => {
    expect(memberScheduleDays(new Date('2026-12-31T23:59:00Z'))[1].date).toBe('2027-01-01');
    expect(memberSessionKey('yoga', '2026-10-19')).not.toBe(memberSessionKey('yoga', '2026-10-26'));
  });

  it('excludes a class that already started today from upcoming bookings', () => {
    expect(isUpcomingMemberBooking('2026-10-17', '07:00:00', saturday)).toBe(false);
    expect(isUpcomingMemberBooking('2026-10-17', '21:00:00', saturday)).toBe(false);
    expect(isUpcomingMemberBooking('2026-10-17', '21:01:00', saturday)).toBe(true);
    expect(isUpcomingMemberBooking('2026-10-18', '07:00:00', saturday)).toBe(true);
    expect(isUpcomingMemberBooking('2026-10-16', '23:00:00', saturday)).toBe(false);
  });
});

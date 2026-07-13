import { describe, expect, it } from 'vitest';
import { calendarLinks } from '@/lib/calendar';

// "Add to calendar" link builder. WAT (UTC+1, no DST) → UTC stamps; a 6pm WAT
// class on 2026-07-20 is 17:00 UTC, and a 60-min class ends 18:00 UTC.
describe('calendarLinks', () => {
  const base = { title: 'Yoga · Zen Gym', dateStr: '2026-07-20', startTime: '18:00', durationMin: 60 };

  it('converts WAT wall-clock to UTC stamps in the Google link', () => {
    const links = calendarLinks(base)!;
    expect(links).not.toBeNull();
    // 18:00 WAT → 17:00 UTC; +60m → 18:00 UTC
    expect(links.google).toContain('dates=20260720T170000Z%2F20260720T180000Z');
    expect(links.google).toContain('calendar.google.com');
  });

  it('emits a valid ICS data URI with matching DTSTART/DTEND', () => {
    const links = calendarLinks(base)!;
    const ics = decodeURIComponent(links.ics.replace(/^data:text\/calendar;charset=utf-8,/, ''));
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20260720T170000Z');
    expect(ics).toContain('DTEND:20260720T180000Z');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('escapes ICS special characters in the summary', () => {
    const links = calendarLinks({ ...base, title: 'HIIT; Power, Speed' })!;
    const ics = decodeURIComponent(links.ics.replace(/^data:[^,]+,/, ''));
    expect(ics).toContain('SUMMARY:HIIT\\; Power\\, Speed');
  });

  it('crosses midnight correctly (23:30 + 60m → next day)', () => {
    const links = calendarLinks({ ...base, startTime: '23:30', durationMin: 60 })!;
    // 23:30 WAT = 22:30 UTC; +60m → 23:30 UTC same day
    expect(links.google).toContain('dates=20260720T223000Z%2F20260720T233000Z');
  });

  it('returns null for an unparseable time or non-positive duration', () => {
    expect(calendarLinks({ ...base, startTime: 'nope' })).toBeNull();
    expect(calendarLinks({ ...base, durationMin: 0 })).toBeNull();
  });
});

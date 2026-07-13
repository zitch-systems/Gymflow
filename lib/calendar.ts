// Build "Add to calendar" links for a booked class — a Google Calendar URL and
// a downloadable .ics (Apple Calendar / Outlook). No third-party account or API
// key: these are plain, universally-supported calendar hand-off formats.
//
// Times are stored as WAT wall-clock (booking_date + schedule start_time). WAT
// is a fixed UTC+1 with no DST, so we convert to UTC once and emit UTC stamps
// (YYYYMMDDTHHMMSSZ) — no VTIMEZONE needed and every calendar app agrees on the
// instant.

const WAT_OFFSET_MIN = 60; // Africa/Lagos = UTC+1, no daylight saving

export type CalEvent = {
  title: string;
  dateStr: string;   // YYYY-MM-DD (WAT calendar day)
  startTime: string; // HH:MM (WAT)
  durationMin: number;
  details?: string;
  location?: string;
  uid?: string;      // stable id (e.g. booking id) for the ICS UID
};

export type CalLinks = { google: string; ics: string; filename: string };

// WAT wall-clock → the corresponding UTC instant.
function toUtc(dateStr: string, startTime: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{1,2}):(\d{2})/.exec(startTime);
  if (!dm || !tm) return null;
  const ms = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]) - WAT_OFFSET_MIN * 60_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Date → YYYYMMDDTHHMMSSZ (UTC "basic format" used by Google Calendar + iCal).
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Escape a value for an iCalendar text field (RFC 5545 §3.3.11).
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Returns the two calendar links, or null when the date/time can't be parsed
// or the duration is non-positive (so callers can simply omit the control).
export function calendarLinks(evt: CalEvent): CalLinks | null {
  const start = toUtc(evt.dateStr, evt.startTime);
  const mins = Math.round(Number(evt.durationMin));
  if (!start || !Number.isFinite(mins) || mins <= 0) return null;
  const end = new Date(start.getTime() + mins * 60_000);
  const s = stamp(start);
  const e = stamp(end);
  const details = evt.details ?? '';
  const location = evt.location ?? '';

  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE',
    text: evt.title,
    dates: `${s}/${e}`,
    details,
    location,
  }).toString();

  const uid = `${(evt.uid ?? s).replace(/[^A-Za-z0-9-]/g, '')}@gymflow.ng`;
  const ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GymFlow//Class Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${s}`,
    `DTSTART:${s}`,
    `DTEND:${e}`,
    `SUMMARY:${icsEscape(evt.title)}`,
    ...(details ? [`DESCRIPTION:${icsEscape(details)}`] : []),
    ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const ics = `data:text/calendar;charset=utf-8,${encodeURIComponent(ical)}`;
  const filename = `${evt.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class'}.ics`;
  return { google, ics, filename };
}

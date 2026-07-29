// Which calendar date a recurring class slot next runs on.
//
// This existed twice, and the two copies disagreed. lib/actions/booking.ts
// rolled a slot whose start time had already passed to NEXT week — correct, you
// can't book a session that has happened — while the class-detail page used a
// plain "next date matching this weekday", which for a 7:00 AM class viewed at
// 5:00 PM still said today. So the member booked (stored against next week's
// date), came back to the page, which looked for a booking dated TODAY, found
// none, and offered "Book your spot" to someone already booked.
//
// One implementation, pure, with `now` injected so the boundaries are testable.
// Callers pass watNow(): gyms and members are in WAT, and a UTC day boundary
// books the wrong date for anything late in the evening.

/**
 * The next date (YYYY-MM-DD) on or after `now` whose weekday is `dow`.
 *
 * When the slot falls today and `startTime` has already passed, rolls a week —
 * so this is always a session that can still be attended. Omit `startTime` to
 * get the plain weekday answer.
 */
export function nextOccurrenceDate(dow: number, startTime: string | null | undefined, now: Date): string {
  // getUTC* on a WAT-shifted Date reads WAT wall-clock.
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  let diff = (((dow - d.getUTCDay()) % 7) + 7) % 7;

  if (diff === 0 && startTime) {
    // Parsed strictly. The old `(h || 0)` coercion turned an unparseable time
    // into 00:00, which reads as "already passed" and silently pushed the slot
    // a week out — bad data quietly becoming a wrong date.
    const m = /^(\d{1,2}):(\d{2})/.exec(String(startTime).trim());
    if (m) {
      const startMins = Number(m[1]) * 60 + Number(m[2]);
      const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      // On the minute counts as gone: a class starting exactly now is not one
      // you book, it's one you're late for.
      if (startMins <= nowMins) diff = 7;
    }
  }

  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Is `date` (YYYY-MM-DD) the WAT date of `now`? Used for the "Today · 7:00 AM"
 *  label, which must agree with the date actually being booked. */
export function isSameWatDate(date: string, now: Date): boolean {
  return date === now.toISOString().slice(0, 10);
}

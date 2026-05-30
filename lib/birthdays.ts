// Pure birthday helpers. Used on the member detail page (the "🎂 today" badge)
// and the admin dashboard's upcoming-birthdays widget.

/**
 * Days from `now` until the next occurrence of `dob`'s month/day.
 *   - returns 0 on the birthday itself
 *   - returns 365 (or 366 if leap-rolling) for the day-after, since the next
 *     occurrence is then a year out
 *   - null when dob is missing/unparseable
 *
 * `dob` is taken as a calendar date (YYYY-MM-DD), not a timestamp — only the
 * month/day are used. All comparisons happen in UTC so the result is stable
 * regardless of which timezone the server function runs in (Vercel regions
 * vary). Using local-timezone Date(year, month, day) here would cause a
 * ±1 day offset for users near midnight in non-UTC timezones.
 *
 * `now` is injectable so tests are deterministic.
 */
export function daysUntilBirthday(dob: string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return null;
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  // UTC throughout — getUTCFullYear/getUTCMonth/getUTCDate + Date.UTC().
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let next = new Date(Date.UTC(now.getUTCFullYear(), month, day));
  if (next < today) next = new Date(Date.UTC(now.getUTCFullYear() + 1, month, day));
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

/** True when the member's birthday is today. */
export function isBirthdayToday(dob: string | null | undefined, now: Date = new Date()): boolean {
  return daysUntilBirthday(dob, now) === 0;
}

/** Friendly label for upcoming birthdays. */
export function birthdayLabel(days: number): string {
  if (days === 0) return 'Today 🎂';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

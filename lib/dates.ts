const DAY_MS = 86_400_000;

export function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

export function daysFromNowDate(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().split('T')[0];
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export function daysAgoDate(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().split('T')[0];
}

export function todayIso(): string {
  return new Date().toISOString();
}

export function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

export function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Add `months` to a date, clamping the day-of-month to the target month's
 * last valid day. Plain `d.setMonth(d.getMonth() + n)` overflows: Jan 31
 * + 1 month lands on Mar 3 (Feb 31 rolls forward), silently handing a member
 * ~2 extra days every renewal that starts on the 29th-31st. This returns
 * Feb 28 (or 29) instead. Pure + non-mutating.
 */
export function addMonths(date: Date, months: number): Date {
  const targetDay = date.getDate();
  const d = new Date(date.getTime());
  d.setDate(1); // park on the 1st so the month shift can't overflow
  d.setMonth(d.getMonth() + months);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDayOfTargetMonth));
  return d;
}

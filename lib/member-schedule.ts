/** Dates in the next seven WAT calendar days, including today. */
export function memberScheduleDays(now: Date, requestedDay?: string) {
  const requested = Number(requestedDay);
  const selected = requestedDay !== undefined && /^[0-6]$/.test(requestedDay)
    ? requested : now.getUTCDay();
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    return {
      date: date.toISOString().slice(0, 10),
      dow: date.getUTCDay(),
      dom: date.getUTCDate(),
      selected: date.getUTCDay() === selected,
    };
  });
}

/** An existing booking stays on its recorded date; it never rolls a week. */
export function isUpcomingMemberBooking(date: string | null, startTime: string | null | undefined, now: Date): boolean {
  if (!date) return false;
  const today = now.toISOString().slice(0, 10);
  if (date !== today) return date > today;
  if (!startTime) return true;
  return startTime.slice(0, 5) > now.toISOString().slice(11, 16);
}

export function memberSessionKey(scheduleId: string, date: string): string {
  return `${scheduleId}:${date}`;
}

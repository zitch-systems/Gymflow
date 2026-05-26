// Pure helpers for member check-in activity (streaks, monthly totals, strip).
// Days are bucketed by UTC calendar date to stay consistent with the rest of
// the app's date handling (see lib/dates.ts).

const DAY_MS = 86_400_000;

export function dayKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().split('T')[0];
}

export type ActivityStrip = { date: string; active: boolean }[];

export type ActivitySummary = {
  visitsThisMonth: number;
  currentStreak: number;
  lastVisit: string | null;
  strip: ActivityStrip;
  totalVisits: number;
};

/**
 * Build an activity summary from check-in timestamps.
 * @param checkIns ISO timestamps of check-ins (any order)
 * @param now reference "today" (defaults to current time)
 */
export function computeActivity(checkIns: (string | null)[], now: Date = new Date()): ActivitySummary {
  const stamps = checkIns.filter((c): c is string => !!c).sort();
  const days = new Set(stamps.map(dayKey));

  const todayKey = dayKey(now);
  const monthPrefix = todayKey.slice(0, 7); // YYYY-MM
  const visitsThisMonth = stamps.filter((s) => dayKey(s).startsWith(monthPrefix)).length;

  // Current streak: walk back from today (allow today OR yesterday as the anchor
  // so a not-yet-checked-in-today member keeps their streak).
  let streak = 0;
  const start = days.has(todayKey) ? now : new Date(now.getTime() - DAY_MS);
  if (days.has(todayKey) || days.has(dayKey(new Date(now.getTime() - DAY_MS)))) {
    for (let cursor = new Date(start); ; cursor = new Date(cursor.getTime() - DAY_MS)) {
      if (days.has(dayKey(cursor))) streak++;
      else break;
    }
  }

  // Last 14 days strip (oldest → newest).
  const strip: ActivityStrip = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayKey(new Date(now.getTime() - i * DAY_MS));
    strip.push({ date: d, active: days.has(d) });
  }

  const lastVisit = stamps.length ? stamps[stamps.length - 1] : null;

  return { visitsThisMonth, currentStreak: streak, lastVisit, strip, totalVisits: stamps.length };
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type ScheduleRow = {
  day_of_week: number;
  start_time: string; // HH:MM[:SS]
  end_time: string;
  room?: string | null;
  classes?: { name?: string | null; instructor?: string | null } | null;
};

export type NextClass = {
  name: string;
  instructor: string | null;
  dayLabel: string;
  start: string;
  end: string;
  room: string | null;
  isToday: boolean;
};

/** Find the next upcoming class from a weekly schedule, relative to `now`. */
export function findNextClass(rows: ScheduleRow[], now: Date = new Date()): NextClass | null {
  if (!rows.length) return null;
  const nowDow = now.getUTCDay();
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  const toMins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  let best: { offset: number; mins: number; row: ScheduleRow } | null = null;
  for (const r of rows) {
    let offset = (r.day_of_week - nowDow + 7) % 7;
    const mins = toMins(r.start_time);
    if (offset === 0 && mins < nowMins) offset = 7; // already passed today → next week
    if (!best || offset < best.offset || (offset === best.offset && mins < best.mins)) {
      best = { offset, mins, row: r };
    }
  }
  if (!best) return null;

  const r = best.row;
  return {
    name: r.classes?.name ?? 'Class',
    instructor: r.classes?.instructor ?? null,
    dayLabel: best.offset === 0 ? 'Today' : best.offset === 1 ? 'Tomorrow' : DAY_LABELS[r.day_of_week],
    start: r.start_time.slice(0, 5),
    end: r.end_time.slice(0, 5),
    room: r.room ?? null,
    isToday: best.offset === 0,
  };
}

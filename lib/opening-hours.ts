import { fmt12Hr } from '@/lib/format';

// "Open now · closes 9:00 PM" for a gym's public page.
//
// The single most useful fact on a gym's landing page is whether you can walk
// in right now, and it was previously only derivable by reading a seven-row
// table at the bottom of the page. Pure so the day-boundary and overnight cases
// are testable — `now` is injected (callers pass watNow(), since the gyms and
// their members are in WAT).

export type HoursRow = {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean | null;
  session?: string | null;
};

export type OpenState = {
  open: boolean;
  /** Short status: "Open now" / "Closed". */
  label: string;
  /** When it changes: "closes 9:00 PM" / "opens 5:00 AM Monday". */
  detail: string | null;
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "05:30" or "05:30:00" → 330. Null for anything unparseable. */
function toMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

type Range = { day: number; open: number; close: number; openRaw: string; closeRaw: string };

function ranges(rows: HoursRow[]): Range[] {
  const out: Range[] = [];
  for (const r of rows) {
    if (r.is_closed) continue;
    const open = toMinutes(r.open_time);
    const close = toMinutes(r.close_time);
    if (open === null || close === null) continue;
    out.push({ day: r.day_of_week, open, close, openRaw: String(r.open_time).slice(0, 5), closeRaw: String(r.close_time).slice(0, 5) });
  }
  return out;
}

/**
 * Is the gym open at `now`, and what changes next?
 *
 * Returns null when the gym has published no usable hours at all — better no
 * badge than a confident "Closed" derived from missing data.
 *
 * Overnight ranges (22:00–02:00) are handled from both ends: a range whose
 * close is before its open runs past midnight, so it counts for the rest of
 * today AND for the small hours of the following day.
 */
export function openStateFor(rows: HoursRow[], now: Date): OpenState | null {
  const all = ranges(rows);
  if (all.length === 0) {
    // "Closed every day" is real, published information; "we have no parseable
    // hours" is not. Only the first deserves a badge.
    return rows.some((r) => r.is_closed) ? { open: false, label: 'Closed', detail: null } : null;
  }

  const today = now.getDay();
  const yesterday = (today + 6) % 7;
  const minutes = now.getHours() * 60 + now.getMinutes();

  // Currently inside a range that started today, or one that started yesterday
  // and runs past midnight.
  const current =
    all.find((r) => r.day === today && (r.close > r.open ? minutes >= r.open && minutes < r.close : minutes >= r.open))
    ?? all.find((r) => r.day === yesterday && r.close < r.open && minutes < r.close);
  if (current) return { open: true, label: 'Open now', detail: `closes ${fmt12Hr(current.closeRaw)}` };

  // Not open — find the next opening, today first, then the following days.
  const laterToday = all.filter((r) => r.day === today && r.open > minutes).sort((a, b) => a.open - b.open)[0];
  if (laterToday) return { open: false, label: 'Closed', detail: `opens ${fmt12Hr(laterToday.openRaw)} today` };

  for (let ahead = 1; ahead <= 7; ahead++) {
    const day = (today + ahead) % 7;
    const next = all.filter((r) => r.day === day).sort((a, b) => a.open - b.open)[0];
    if (!next) continue;
    const when = ahead === 1 ? 'tomorrow' : DAY_NAMES[day];
    return { open: false, label: 'Closed', detail: `opens ${fmt12Hr(next.openRaw)} ${when}` };
  }

  return { open: false, label: 'Closed', detail: null };
}

/** Today's published ranges, formatted — "5:00 AM – 12:00 PM · 5:00 PM – 9:00 PM". */
export function todayHoursLabel(rows: HoursRow[], now: Date): string | null {
  const today = ranges(rows)
    .filter((r) => r.day === now.getDay())
    .sort((a, b) => a.open - b.open);
  if (today.length === 0) return null;
  return today.map((r) => `${fmt12Hr(r.openRaw)} – ${fmt12Hr(r.closeRaw)}`).join(' · ');
}

/** How many days a week the gym opens at all — a stronger fact than "3 plans". */
export function openDaysPerWeek(rows: HoursRow[]): number {
  return new Set(ranges(rows).map((r) => r.day)).size;
}

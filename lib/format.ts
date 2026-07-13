// Shared formatting helpers.

export function fmtNaira(n: number | null | undefined): string {
  return `₦${Number(n ?? 0).toLocaleString('en-NG')}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "HH:MM" (24h) → "H:MM AM/PM". Business hours are stored 24h in Postgres; the
// admin editor and the public landing page both display 12h with an AM/PM
// suffix, which is what Nigerian gym members expect.
export function fmt12Hr(hhmm: string | null | undefined): string {
  if (!hhmm) return '—';
  const [hStr, mStr] = String(hhmm).split(':');
  const h = Number(hStr); const m = Number(mStr ?? '0');
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// Normalize a business/account name for case- and punctuation-insensitive
// comparison (e.g. "Powerhouse Fitness Ltd." vs "POWERHOUSE FITNESS LTD").
// Strips common company suffixes so an account holder name like "Powerhouse
// Fitness" still matches the gym registered as "Powerhouse Fitness Ltd".
export function normalizeBusinessName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(ltd|limited|nig|nigeria|plc|inc|llc|gmbh|co|company|and|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Time zone ──────────────────────────────────────────────────────────────
// The platform operates in Nigeria (WAT = UTC+1, no DST), but the server runtime
// is UTC. Deriving a calendar day with `toISOString().slice(0,10)` therefore
// mis-buckets any activity between 00:00–01:00 WAT onto the previous day — wrong
// for "today" gates (check-in de-dupe, subscription expiry, booking dates). These
// helpers anchor day boundaries to WAT.
const WAT_OFFSET_MS = 60 * 60 * 1000;

// "Now" as a Date whose UTC getters (getUTCDay/Hours/…) read WAT wall-clock.
export function watNow(): Date {
  return new Date(Date.now() + WAT_OFFSET_MS);
}

// Calendar date (YYYY-MM-DD) in WAT for a given instant (defaults to now).
export function watDateISO(instant: Date = new Date()): string {
  return new Date(instant.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

// The UTC instant of WAT midnight for a WAT calendar date (YYYY-MM-DD) — use as
// a lower bound when filtering UTC timestamps by "since the start of today (WAT)".
export function watDayStartUtc(watDate: string): string {
  return new Date(`${watDate}T00:00:00+01:00`).toISOString();
}

// Whole days from now until `iso` (clamped at 0).
export function daysLeft(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function firstName(full: string | null | undefined, fallback = 'there'): string {
  const f = (full ?? '').trim().split(/\s+/)[0];
  return f || fallback;
}

// Initials for an avatar chip (first + last initial), e.g. "Adunni Okafor" → "AO".
export function initialsOf(name: string | null | undefined, fallback = 'U'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const a = parts[0][0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (a + b).toUpperCase() || fallback;
}

// Human label for a staff/role string (gym_staff_links.role / profiles.role).
const ROLE_LABELS: Record<string, string> = {
  gym_owner: 'Owner', owner: 'Owner', manager: 'Manager',
  front_desk: 'Front desk', accountant: 'Accountant', instructor: 'Instructor',
};
export function roleLabel(role: string | null | undefined): string {
  const r = (role ?? '').trim();
  return ROLE_LABELS[r] ?? (r ? r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Staff');
}

// Split a display name into first/last for writes. profiles.full_name is a
// GENERATED column in the live DB (computed from first_name/last_name) —
// writing it fails with `cannot insert a non-DEFAULT value into column
// "full_name"` — so every profile write goes through this instead.
export function splitName(full: string | null | undefined): { first_name: string | null; last_name: string | null } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: null, last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') || null };
}

// Normalize a Nigerian mobile number to canonical 11-digit local form
// (0XXXXXXXXXX). Accepts common inputs — spaces/dashes, a +234/234 country
// code, or a leading-zero-less 10-digit number. Returns null when it isn't a
// valid NG mobile (must be 11 digits, 0 then 7/8/9), so callers can reject it.
export function normalizeNgPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (d.startsWith('234')) {
    // "+234 803…" and the common redundant-zero paste "+234 0803…" both work.
    const rest = d.slice(3);
    d = rest.startsWith('0') ? rest : `0${rest}`;
  } else if (d.length === 10 && /^[789]/.test(d)) d = `0${d}`; // 803… → 0803…
  return /^0[789]\d{9}$/.test(d) ? d : null;
}

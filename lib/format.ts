// Shared formatting helpers.

export function fmtNaira(n: number | null | undefined): string {
  return `₦${Number(n ?? 0).toLocaleString('en-NG')}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
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

// Split a display name into first/last for writes. profiles.full_name is a
// GENERATED column in the live DB (computed from first_name/last_name) —
// writing it fails with `cannot insert a non-DEFAULT value into column
// "full_name"` — so every profile write goes through this instead.
export function splitName(full: string | null | undefined): { first_name: string | null; last_name: string | null } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: null, last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') || null };
}

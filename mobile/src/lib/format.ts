// Formatting, matched to lib/format.ts on the web so the two surfaces render the
// same value the same way. Nigeria is UTC+1 with no DST.

export function naira(n: number | null | undefined): string {
  return `₦${Number(n ?? 0).toLocaleString('en-NG')}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dayMonth(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function clockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "18:30" → "6:30 PM". */
export function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return '—';
  const [hStr, mStr = '00'] = String(hhmm).split(':');
  const h = Number(hStr);
  if (!Number.isFinite(h)) return String(hhmm);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${((h + 11) % 12) + 1}:${mStr.padStart(2, '0')} ${suffix}`;
}

export function duration(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const mins = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

export function firstName(full: string | null | undefined): string {
  const n = (full ?? '').trim().split(/\s+/)[0];
  return n || 'there';
}

export function initial(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = (c ?? '').trim();
    if (t) return t.charAt(0).toUpperCase();
  }
  return 'M';
}

/** "Today · 18:04", "Fri · 07:12", or "3 Feb" — the inbox's time column. */
export function inboxTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const clock = d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === new Date(now).toDateString()) return `Today · ${clock}`;
  if (now - d.getTime() < 7 * 86_400_000) return `${d.toLocaleDateString('en-NG', { weekday: 'short' })} · ${clock}`;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

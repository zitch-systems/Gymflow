export function fmtNaira(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return '₦' + Number(amount).toLocaleString('en-NG');
}

export function fmtDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtDateTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function daysLeft(expiryDate: string | Date | null | undefined): number {
  if (!expiryDate) return 0;
  const diff = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000);
  return Math.max(0, diff);
}

export function relativeTime(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString();
}

/**
 * Time-of-day greeting in West Africa Time (UTC+1) — GymFlow's market is
 * Nigeria, so the greeting should track the member's local morning/evening
 * regardless of which region the server function runs in. `now` is injectable
 * for deterministic tests.
 */
export function greeting(now: Date = new Date()): string {
  // Shift to WAT (UTC+1) then read the hour off the UTC clock.
  const watHour = new Date(now.getTime() + 60 * 60 * 1000).getUTCHours();
  if (watHour < 12) return 'Good morning';
  if (watHour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name from a full name (or a fallback). */
export function firstName(full: string | null | undefined, fallback = 'there'): string {
  const f = (full ?? '').trim().split(/\s+/)[0];
  return f || fallback;
}

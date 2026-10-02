import { createHash } from 'crypto';

const SAFE_CONTEXT_KEYS = new Set([
  'attempts', 'count', 'deferred', 'event', 'gymId', 'job', 'reference',
  'source', 'status', 'trigger',
]);

/** Remove common credentials and personal identifiers before an error reaches
 * logs, Sentry, or the operator incident table. Provider messages are treated
 * as untrusted input: they sometimes echo an email, account number, or URL. */
export function redactOperationalText(value: unknown, max = 2_000): string {
  return String(value ?? 'unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|key|secret|signature|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b\d{10,19}\b/g, '[redacted-number]')
    .replace(/\b(?:sk|pk|whsec)_[A-Za-z0-9_-]{12,}\b/g, '[redacted-secret]')
    .slice(0, max);
}

export function safeIncidentContext(extra?: Record<string, unknown>): Record<string, unknown> {
  if (!extra) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(extra)) {
    if (!SAFE_CONTEXT_KEYS.has(key) || raw == null) continue;
    if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = raw;
    else if (typeof raw === 'string') out[key] = redactOperationalText(raw, 300);
    else if (Array.isArray(raw)) {
      out[key] = raw.slice(0, 10).filter((v) => typeof v === 'string').map((v) => redactOperationalText(v, 200));
    }
  }
  return out;
}

export function incidentReference(extra?: Record<string, unknown>): string | null {
  for (const key of ['reference', 'gymId', 'job']) {
    const value = extra?.[key];
    if (typeof value === 'string' && value) return redactOperationalText(value, 200);
  }
  return null;
}

export function incidentDedupeKey(message: string, error: string, reference: string | null): string {
  return createHash('sha256').update(`${message}\0${reference ?? ''}\0${error}`).digest('hex');
}

export function retryDelaySeconds(attempts: number): number {
  return Math.min(21_600, Math.max(60, 60 * (2 ** Math.min(Math.max(attempts - 1, 0), 9))));
}

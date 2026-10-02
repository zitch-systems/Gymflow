import { describe, expect, it } from 'vitest';
import {
  incidentDedupeKey,
  redactOperationalText,
  retryDelaySeconds,
  safeIncidentContext,
} from '@/lib/operational-core';

describe('operational incident redaction', () => {
  it('removes credentials, email addresses, and account-like numbers', () => {
    const message = 'Bearer abc.def.ghi user@example.com account 0123456789 ?secret=shh sk_live_1234567890123456';
    const safe = redactOperationalText(message);
    expect(safe).not.toContain('abc.def.ghi');
    expect(safe).not.toContain('user@example.com');
    expect(safe).not.toContain('0123456789');
    expect(safe).not.toContain('sk_live_');
    expect(safe).toContain('[redacted');
  });

  it('keeps an allowlisted, bounded context instead of persisting arbitrary payloads', () => {
    expect(safeIncidentContext({
      job: 'paystack_reconciliation', count: 7, email: 'person@example.com',
      payload: { card: 'secret' }, reference: 'ref_123',
    })).toEqual({ job: 'paystack_reconciliation', count: 7, reference: 'ref_123' });
  });

  it('deduplicates identical reference/error incidents and separates distinct references', () => {
    expect(incidentDedupeKey('failure', 'timeout', 'ref-a')).toBe(incidentDedupeKey('failure', 'timeout', 'ref-a'));
    expect(incidentDedupeKey('failure', 'timeout', 'ref-a')).not.toBe(incidentDedupeKey('failure', 'timeout', 'ref-b'));
  });
});

describe('recovery backoff', () => {
  it('starts at one minute and caps at six hours', () => {
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(120);
    expect(retryDelaySeconds(100)).toBe(21_600);
  });
});

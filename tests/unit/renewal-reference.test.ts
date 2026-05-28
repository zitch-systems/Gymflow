import { describe, it, expect, vi } from 'vitest';

// The route file imports server-only modules (paystack-fulfill chain). Stub
// what it touches at import time; we only exercise the exported helper.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/paystack', () => ({ paystackFetch: vi.fn() }));

import { renewalReference } from '@/app/api/cron/platform-renewals/route';

describe('renewalReference — platform-renewals idempotency token', () => {
  it('is deterministic for the same (gym, day) tuple', () => {
    const a = renewalReference('gym-abc', '2026-05-29');
    const b = renewalReference('gym-abc', '2026-05-29');
    expect(a).toBe(b);
  });

  it('differs across days for the same gym', () => {
    const a = renewalReference('gym-abc', '2026-05-29');
    const b = renewalReference('gym-abc', '2026-05-30');
    expect(a).not.toBe(b);
  });

  it('differs across gyms on the same day', () => {
    const a = renewalReference('gym-abc', '2026-05-29');
    const b = renewalReference('gym-xyz', '2026-05-29');
    expect(a).not.toBe(b);
  });

  it('matches the GFP-<gym>-<date> shape so Paystack rejects collisions', () => {
    expect(renewalReference('gym-1', '2026-05-29')).toBe('GFP-gym-1-2026-05-29');
  });
});

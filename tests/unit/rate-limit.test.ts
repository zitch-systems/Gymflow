import { describe, it, expect } from 'vitest';
import { rateLimit } from '@/lib/rate-limit';

describe('rateLimit', () => {
  it('allows up to `limit` calls within the window, then blocks', () => {
    const key = `rl-test-${Math.random()}`;
    const opts = { key, limit: 3, windowMs: 60_000 };
    expect(rateLimit(opts).ok).toBe(true);
    expect(rateLimit(opts).ok).toBe(true);
    expect(rateLimit(opts).ok).toBe(true);
    const fourth = rateLimit(opts);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });

  it('keys are independent — one key being throttled does not affect another', () => {
    const a = `rl-test-a-${Math.random()}`;
    const b = `rl-test-b-${Math.random()}`;
    rateLimit({ key: a, limit: 1, windowMs: 60_000 });
    const aBlocked = rateLimit({ key: a, limit: 1, windowMs: 60_000 });
    const bFresh = rateLimit({ key: b, limit: 1, windowMs: 60_000 });
    expect(aBlocked.ok).toBe(false);
    expect(bFresh.ok).toBe(true);
  });

  it('resets when the window elapses', async () => {
    const key = `rl-test-reset-${Math.random()}`;
    const opts = { key, limit: 1, windowMs: 50 };
    expect(rateLimit(opts).ok).toBe(true);
    expect(rateLimit(opts).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 70));
    expect(rateLimit(opts).ok).toBe(true);
  });
});

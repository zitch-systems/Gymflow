import { describe, it, expect } from 'vitest';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

describe('rateLimitResponse', () => {
  it('returns a 429 with a Retry-After header derived from the bucket reset time', () => {
    const key = `rl-resp-${Math.random()}`;
    // Burn the bucket so the next call is blocked.
    rateLimit({ key, limit: 1, windowMs: 60_000 });
    const blocked = rateLimit({ key, limit: 1, windowMs: 60_000 });
    expect(blocked.ok).toBe(false);
    const res = rateLimitResponse(blocked);
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get('Retry-After'));
    // Retry-After is whole seconds; allow a small slack since the bucket was
    // set milliseconds before this line ran.
    expect(retry).toBeGreaterThan(50);
    expect(retry).toBeLessThanOrEqual(60);
    expect(res.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/);
  });

  it('encodes a JSON body the client can surface to the user', async () => {
    const blocked = { ok: false as const, remaining: 0, resetAt: Date.now() + 5000, retryAfterSec: 5 };
    const res = rateLimitResponse(blocked);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

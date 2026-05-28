import 'server-only';
import { headers } from 'next/headers';

// In-memory sliding-window rate limiter.
//
// Caveat: per-serverless-instance. A burst hitting one warm Vercel lambda is
// blocked; an attacker who spreads requests across instances effectively gets
// N × limit. This is still meaningfully better than zero — it neutralises the
// common single-host card-testing / credential-stuffing / enumeration patterns
// that hit a warm function repeatedly. For production-grade distributed limits
// across regions, swap the backing store for Upstash Redis or Vercel KV by
// wiring `incrementBucket` to a Redis INCR + EXPIRE (the public API of this
// module — `rateLimit(key, opts)` — stays the same).

type Bucket = { count: number; resetAt: number };

// Global Map survives within a warm lambda execution; reclaimed on cold start.
// Cap entries so a flood of unique IPs cannot exhaust memory.
const MAX_KEYS = 5000;
const buckets: Map<string, Bucket> = new Map();

function incrementBucket(key: string, windowMs: number): Bucket {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    if (buckets.size > MAX_KEYS) {
      // Evict the oldest entry to bound memory.
      const firstKey = buckets.keys().next().value;
      if (firstKey) buckets.delete(firstKey);
    }
    return fresh;
  }
  existing.count += 1;
  return existing;
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
};

export type RateLimitOpts = {
  /** Identifier, typically `${routeName}:${ip}` or `${action}:${email}`. */
  key: string;
  /** Maximum requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export function rateLimit(opts: RateLimitOpts): RateLimitResult {
  const bucket = incrementBucket(opts.key, opts.windowMs);
  const remaining = Math.max(0, opts.limit - bucket.count);
  const resetAt = bucket.resetAt;
  const retryAfterSec = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
  return { ok: bucket.count <= opts.limit, remaining, resetAt, retryAfterSec };
}

/**
 * Extract a best-effort client IP from forwarded headers. Vercel sets
 * `x-forwarded-for` (first hop is the client) and `x-real-ip`. Falls back
 * to a constant so we still rate-limit when behind an unknown proxy
 * (one shared bucket beats none).
 */
export function clientIpFromRequest(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/** Server-action equivalent: pulls headers from the Next.js context. */
export async function clientIpFromHeaders(): Promise<string> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('x-real-ip') ?? 'unknown';
}

/** Convenience: build a 429 Response with the standard Retry-After header. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: 'Too many requests, slow down.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(result.retryAfterSec),
      'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    },
  });
}

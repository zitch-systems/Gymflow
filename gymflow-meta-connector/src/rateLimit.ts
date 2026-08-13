import type { NextFunction, Request, Response } from 'express';

import type { Config } from './config.js';

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  consume(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count > this.maxRequests) {
      return { allowed: false, retryAfterMs: window.resetAt - now };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  sweep(now: number = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

function respondRateLimited(res: Response, retryAfterMs: number): void {
  res.status(429).json({
    error: 'rate_limited',
    message: `Too many requests. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
  });
}

export function rateLimitMiddleware(_config: Config, limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = (res.locals.keyFingerprint as string | undefined) || req.ip || 'unknown';
    const result = limiter.consume(key);
    if (!result.allowed) {
      respondRateLimited(res, result.retryAfterMs);
      return;
    }
    next();
  };
}

export function ipRateLimitMiddleware(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = limiter.consume(req.ip || 'unknown');
    if (!result.allowed) {
      respondRateLimited(res, result.retryAfterMs);
      return;
    }
    next();
  };
}

export function startRateLimiterSweep(limiter: RateLimiter, intervalMs = 60_000): () => void {
  const timer = setInterval(() => limiter.sweep(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

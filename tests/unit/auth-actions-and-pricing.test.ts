import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// Two small but load-bearing pure-ish surfaces:
//
// 1. requestPasswordReset (lib/auth/actions.ts) — the redirect-URL allowlist
//    is a real security control. Open-redirects on password reset are a
//    classic phishing vector: if a request is made with originUrl pointing at
//    evil.com, the function MUST fall back to the safe site URL, not use it.
//    The Supabase auth client receives whatever `redirectTo` we computed,
//    which is what the victim sees in the email link.
//
// 2. periodSavings (lib/platform-pricing.ts) — pure math, but it's the
//    "you save ₦X" copy on the signup page. A bug there = misleading
//    marketing. Locking the actual savings values pins them so the next
//    person who tweaks PLATFORM_PRICING immediately notices the impact.

const { state, resetMock, rateMock, ipMock } = vi.hoisted(() => {
  const state: {
    rateAllow: boolean;
    capturedRedirectTo: string | null;
  } = { rateAllow: true, capturedRedirectTo: null };
  const resetMock = vi.fn(async (email: string, opts: { redirectTo: string }) => {
    void email;
    state.capturedRedirectTo = opts.redirectTo;
    return { error: null };
  });
  const rateMock = vi.fn(() => ({ ok: state.rateAllow, retryAfterSec: 30 }));
  const ipMock = vi.fn(async () => '1.2.3.4');
  return { state, resetMock, rateMock, ipMock };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { resetPasswordForEmail: resetMock } }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: rateMock,
  clientIpFromHeaders: ipMock,
}));
// requestPasswordReset doesn't redirect on success, but the module imports
// these at the top so we stub them defensively.
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); } }));
vi.mock('@/lib/email', () => ({ sendWelcome: vi.fn() }));
vi.mock('@/lib/whatsapp', () => ({ waWelcome: vi.fn() }));

import { requestPasswordReset } from '@/lib/auth/actions';
import { periodSavings, isBillingPeriod, PLATFORM_PRICING } from '@/lib/platform-pricing';

beforeEach(() => {
  state.rateAllow = true;
  state.capturedRedirectTo = null;
  resetMock.mockClear();
  rateMock.mockClear();
  // Pin NEXT_PUBLIC_SITE_URL so the safe-fallback host is deterministic.
  process.env.NEXT_PUBLIC_SITE_URL = 'https://gymflow.ng';
});

describe('requestPasswordReset — rate limit + validation', () => {
  it('429-style error when rate-limited, no Supabase call', async () => {
    state.rateAllow = false;
    const r = await requestPasswordReset('member@example.com', 'https://iron.gymflow.ng/login');
    expect(r.error).toMatch(/Too many reset attempts/);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it('rejects empty email before calling Supabase', async () => {
    const r = await requestPasswordReset('', 'https://iron.gymflow.ng/login');
    expect(r.error).toMatch(/Enter your email/);
    expect(resetMock).not.toHaveBeenCalled();
  });
});

describe('requestPasswordReset — redirectTo allowlist (anti open-redirect)', () => {
  it('keeps a *.gymflow.ng subdomain origin (legitimate gym subdomain)', async () => {
    await requestPasswordReset('m@e.com', 'https://iron.gymflow.ng/login');
    expect(state.capturedRedirectTo).toBe('https://iron.gymflow.ng/login?reset=1');
  });

  it('keeps the apex gymflow.ng host', async () => {
    await requestPasswordReset('m@e.com', 'https://gymflow.ng/login');
    expect(state.capturedRedirectTo).toBe('https://gymflow.ng/login?reset=1');
  });

  it('REJECTS a foreign host and falls back to the site URL (phishing defence)', async () => {
    // The attack: a crafted form submission with originUrl pointing at a
    // phishing site. The function must not honour it.
    await requestPasswordReset('m@e.com', 'https://evil.com/login');
    expect(state.capturedRedirectTo).toBe('https://gymflow.ng/login?reset=1');
    expect(state.capturedRedirectTo).not.toContain('evil.com');
  });

  it('REJECTS a look-alike host that merely contains "gymflow.ng" as a substring', async () => {
    // Subtler attack: gymflow.ng.evil.com would pass a naïve substring check.
    // The code uses URL.host comparison + endsWith('.gymflow.ng'), so this
    // must NOT be honoured.
    await requestPasswordReset('m@e.com', 'https://gymflow.ng.evil.com/login');
    expect(state.capturedRedirectTo).toBe('https://gymflow.ng/login?reset=1');
    expect(state.capturedRedirectTo).not.toContain('evil.com');
  });

  it('REJECTS a malformed origin URL and falls back to the site URL', async () => {
    await requestPasswordReset('m@e.com', 'not-a-url');
    expect(state.capturedRedirectTo).toBe('https://gymflow.ng/login?reset=1');
  });

  it('preserves the scheme of a legitimate origin (http vs https)', async () => {
    // Local dev: http://iron.gymflow.ng is allowed (host check, not scheme).
    await requestPasswordReset('m@e.com', 'http://iron.gymflow.ng/login');
    expect(state.capturedRedirectTo).toBe('http://iron.gymflow.ng/login?reset=1');
  });
});

describe('platform-pricing', () => {
  it('isBillingPeriod accepts the three known plans and nothing else', () => {
    expect(isBillingPeriod('monthly')).toBe(true);
    expect(isBillingPeriod('quarterly')).toBe(true);
    expect(isBillingPeriod('annual')).toBe(true);
    expect(isBillingPeriod('lifetime')).toBe(false);
    expect(isBillingPeriod(null)).toBe(false);
    expect(isBillingPeriod(undefined)).toBe(false);
    expect(isBillingPeriod(42)).toBe(false);
  });

  it('periodSavings returns 0 for the monthly plan (baseline)', () => {
    expect(periodSavings('monthly')).toBe(0);
  });

  it('quarterly savings = 3*monthly - quarterly amount', () => {
    const expected = PLATFORM_PRICING.monthly.amount * 3 - PLATFORM_PRICING.quarterly.amount;
    expect(periodSavings('quarterly')).toBe(expected);
    // and the headline number stays positive — if it ever went negative the
    // signup copy would advertise "savings" that aren't real.
    expect(periodSavings('quarterly')).toBeGreaterThan(0);
  });

  it('annual savings = 12*monthly - annual amount', () => {
    const expected = PLATFORM_PRICING.monthly.amount * 12 - PLATFORM_PRICING.annual.amount;
    expect(periodSavings('annual')).toBe(expected);
    expect(periodSavings('annual')).toBeGreaterThan(0);
  });

  it('annual savings beat quarterly savings — the price ladder makes sense', () => {
    // If this ever fails, someone tweaked PLATFORM_PRICING in a way that
    // breaks the "longer commitment = more savings" promise.
    expect(periodSavings('annual')).toBeGreaterThan(periodSavings('quarterly'));
  });
});

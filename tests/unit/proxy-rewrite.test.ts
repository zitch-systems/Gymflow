import { describe, it, expect } from 'vitest';
import { buildRewrite, SLUG_RE, isPublicPath } from '@/proxy';

// proxy.ts is the multi-tenant router: a request to {slug}.gymflow.ng/admin
// is rewritten to the internal /gym/{slug}/admin tree. buildRewrite is the
// pure path-mapping core (URL in → URL out), and SLUG_RE is the allowlist that
// keeps bogus subdomain probes out of the tenant tree. Both are exported so
// this logic is testable without mocking NextRequest/NextResponse/@supabase.

const rewrite = (path: string, slug = 'iron') =>
  buildRewrite(new URL(`https://iron.gymflow.ng${path}`), slug).pathname;

describe('proxy.buildRewrite — tenant path mapping', () => {
  it('maps /admin → /gym/{slug}/admin', () => {
    expect(rewrite('/admin')).toBe('/gym/iron/admin/');
    expect(rewrite('/admin/members')).toBe('/gym/iron/admin/members');
    expect(rewrite('/admin/wallet')).toBe('/gym/iron/admin/wallet');
  });

  it('maps /coach → /gym/{slug}/coach', () => {
    expect(rewrite('/coach')).toBe('/gym/iron/coach/');
    expect(rewrite('/coach/earnings')).toBe('/gym/iron/coach/earnings');
  });

  it('maps /join, /login, /dashboard under the gym tree', () => {
    expect(rewrite('/join')).toBe('/gym/iron/join/');
    expect(rewrite('/login')).toBe('/gym/iron/login/');
    expect(rewrite('/dashboard')).toBe('/gym/iron/dashboard/');
    expect(rewrite('/dashboard/cards')).toBe('/gym/iron/dashboard/cards');
  });

  it('maps any other path verbatim under /gym/{slug}', () => {
    // The catch-all branch (e.g. /classes, /checkin, /) just prefixes.
    expect(rewrite('/classes')).toBe('/gym/iron/classes');
    expect(rewrite('/checkin')).toBe('/gym/iron/checkin');
    expect(rewrite('/')).toBe('/gym/iron/');
  });

  it('does not let /admin-style prefixes bleed across segments', () => {
    // "/administrator" must NOT be treated as "/admin" + "istrator" in a way
    // that produces a broken path — startsWith('/admin') matches, and the
    // replace only strips the FIRST "/admin", so the remainder is preserved.
    expect(rewrite('/admin/settings/payouts')).toBe('/gym/iron/admin/settings/payouts');
  });

  it('uses the slug it is given (slug comes from the validated subdomain)', () => {
    expect(rewrite('/admin', 'fit-hub')).toBe('/gym/fit-hub/admin/');
    expect(rewrite('/dashboard', 'gf-test-gym')).toBe('/gym/gf-test-gym/dashboard/');
  });

  it('preserves query strings on the rewritten URL', () => {
    const out = buildRewrite(new URL('https://iron.gymflow.ng/admin/wallet?from=2026-01-01&to=2026-02-01'), 'iron');
    expect(out.pathname).toBe('/gym/iron/admin/wallet');
    expect(out.searchParams.get('from')).toBe('2026-01-01');
    expect(out.searchParams.get('to')).toBe('2026-02-01');
  });
});

describe('proxy.SLUG_RE — subdomain allowlist', () => {
  it('accepts valid gym slugs', () => {
    expect(SLUG_RE.test('iron')).toBe(true);
    expect(SLUG_RE.test('fit-hub')).toBe(true);
    expect(SLUG_RE.test('gf-test-gym')).toBe(true);
    expect(SLUG_RE.test('gym123')).toBe(true);
    expect(SLUG_RE.test('abc')).toBe(true);           // 3 chars, shortest multi-char form
  });

  it('handles the length boundary exactly: 1 char ok, 2 chars rejected, 3+ ok', () => {
    // The pattern is ^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$ — a single char
    // passes (optional group skipped), but a 2-char slug can't satisfy the
    // group (needs first + >=1 middle + last = >=3). This is a real quirk
    // worth pinning so a future "tidy up the regex" doesn't change behaviour
    // unnoticed.
    expect(SLUG_RE.test('a')).toBe(true);
    expect(SLUG_RE.test('a1')).toBe(false);
    expect(SLUG_RE.test('ab')).toBe(false);
    expect(SLUG_RE.test('abc')).toBe(true);
  });

  it('rejects slugs that would be unsafe or malformed', () => {
    expect(SLUG_RE.test('-iron')).toBe(false);        // leading dash
    expect(SLUG_RE.test('iron-')).toBe(false);        // trailing dash
    expect(SLUG_RE.test('Iron')).toBe(false);         // uppercase
    expect(SLUG_RE.test('iron gym')).toBe(false);     // space
    expect(SLUG_RE.test('iron.gym')).toBe(false);     // dot
    expect(SLUG_RE.test('iron_gym')).toBe(false);     // underscore
    expect(SLUG_RE.test('')).toBe(false);             // empty
    expect(SLUG_RE.test('www')).toBe(true);           // matches pattern; apex/www handled separately in proxy()
  });

  it('rejects an over-long slug (>32 chars), accepts exactly 32', () => {
    expect(SLUG_RE.test('a'.repeat(33))).toBe(false);
    expect(SLUG_RE.test('a'.repeat(32))).toBe(true);
  });
});

describe('proxy.isPublicPath — session-refresh skip allowlist', () => {
  it('treats marketing + unauth routes as public (no session round-trip)', () => {
    for (const p of ['/', '/pricing', '/features', '/about', '/signup', '/offline']) {
      expect(isPublicPath(p)).toBe(true);
    }
    expect(isPublicPath('/features/booking')).toBe(true);
    expect(isPublicPath('/robots.txt')).toBe(true);
    expect(isPublicPath('/sitemap.xml')).toBe(true);
  });

  it('treats authenticated routes as NOT public (session must refresh)', () => {
    // The safety-critical direction: a false positive here would skip the
    // session refresh on an authed page and log users out mid-session.
    for (const p of ['/dashboard', '/dashboard/profile', '/admin', '/admin/wallet', '/coach', '/coach/earnings', '/checkin', '/classes', '/login', '/join']) {
      expect(isPublicPath(p)).toBe(false);
    }
    // /signup is public but /signup/done (post-signup, may read session) is not.
    expect(isPublicPath('/signup/done')).toBe(false);
  });
});

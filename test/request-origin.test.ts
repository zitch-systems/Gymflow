import { describe, expect, it } from 'vitest';
import { originForHost } from '@/lib/tenant';

// Paystack callbacks were hardcoded to NEXT_PUBLIC_SITE_URL (the apex), while
// members browse their gym's subdomain. Supabase auth cookies are host-scoped,
// so a member who paid came back to a host where they had no session and got
// the GymFlow login page — after being charged. These rules decide which host
// a payer is returned to, so each one is pinned.

const SITE = 'https://gymflow.ng';

describe('originForHost', () => {
  it('returns the gym subdomain the member was actually on', () => {
    expect(originForHost('iron-republic.gymflow.ng', 'https', SITE)).toBe('https://iron-republic.gymflow.ng');
  });

  it('returns the apex when that is where they were', () => {
    expect(originForHost('gymflow.ng', 'https', SITE)).toBe('https://gymflow.ng');
    expect(originForHost('www.gymflow.ng', 'https', SITE)).toBe('https://www.gymflow.ng');
  });

  it('keeps the port in development', () => {
    expect(originForHost('localhost:3000', null, SITE)).toBe('http://localhost:3000');
    expect(originForHost('127.0.0.1:3000', null, SITE)).toBe('http://127.0.0.1:3000');
  });

  it('keeps preview deploys on the preview host', () => {
    // Returning to the apex from a preview would drop the payer into production.
    expect(originForHost('gymflow-git-branch.vercel.app', 'https', SITE)).toBe('https://gymflow-git-branch.vercel.app');
  });

  it('falls back to the configured site for a host that is not ours', () => {
    // A spoofed Host header must not turn our checkout into a redirect
    // somewhere else.
    expect(originForHost('evil.example.com', 'https', SITE)).toBe(SITE);
    expect(originForHost('gymflow.ng.evil.com', 'https', SITE)).toBe(SITE);
    expect(originForHost(null, 'https', SITE)).toBe(SITE);
  });

  it('takes the first proto when the header is a comma-separated chain', () => {
    expect(originForHost('iron.gymflow.ng', 'https,http', SITE)).toBe('https://iron.gymflow.ng');
  });

  it('defaults to https for our own hosts when no proto is given', () => {
    expect(originForHost('iron.gymflow.ng', null, SITE)).toBe('https://iron.gymflow.ng');
  });

  it('never emits a trailing slash to double up on the callback path', () => {
    // `${site}/dashboard/renew/callback` would otherwise become a // path.
    expect(originForHost(null, null, 'https://gymflow.ng/')).toBe('https://gymflow.ng');
    expect(originForHost('iron.gymflow.ng', 'https', SITE).endsWith('/')).toBe(false);
  });

  it('is case-insensitive about the host', () => {
    expect(originForHost('Iron-Republic.GymFlow.NG', 'https', SITE)).toBe('https://Iron-Republic.GymFlow.NG');
  });
});

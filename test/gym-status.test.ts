import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFLINE_GYM_FILTER, OFFLINE_GYM_STATUSES, gymIsOffline, isOfflineGym } from '../lib/gym-status';

// `gyms.status` is the platform's off switch for a tenant. It used to be
// checked with an inline `=== 'suspended'` in five places, every one of them a
// render guard, so a suspended gym went on taking signups through /join and the
// mobile API, went on opening Paystack checkouts that settled to its own
// subaccount, and went on sending gym-branded mail from the nightly cron.
//
// The predicate below is trivial. The test that earns its keep is the second
// block: the bug was never in the comparison, it was in the resolvers that
// never made one.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');

describe('gymIsOffline', () => {
  it('treats suspended and terminated as off', () => {
    expect(gymIsOffline('suspended')).toBe(true);
    expect(gymIsOffline('terminated')).toBe(true);
  });

  it('leaves trading gyms alone', () => {
    expect(gymIsOffline('active')).toBe(false);
    expect(gymIsOffline('trial')).toBe(false);
  });

  it('fails open on an unknown or missing status', () => {
    // status is NOT NULL with a default, so null here means a narrow select or
    // a failed read — neither is grounds for blacking out a paying tenant.
    expect(gymIsOffline(null)).toBe(false);
    expect(gymIsOffline(undefined)).toBe(false);
    expect(gymIsOffline('')).toBe(false);
    expect(gymIsOffline('some_future_status')).toBe(false);
  });

  it('isOfflineGym is false for a missing gym, so callers keep their own null check', () => {
    // A null gym is "not found", not "switched off" — the two have the same
    // outcome at most call sites but they are not the same fact, and collapsing
    // them once already turned an unknown-slug 404 into a served response.
    expect(isOfflineGym(null)).toBe(false);
    expect(isOfflineGym(undefined)).toBe(false);
    expect(isOfflineGym({ status: 'suspended' })).toBe(true);
    expect(isOfflineGym({ status: 'active' })).toBe(false);
    expect(isOfflineGym({})).toBe(false);
  });

  it('exposes the status list as a PostgREST in-filter', () => {
    expect(OFFLINE_GYM_FILTER).toBe(`(${OFFLINE_GYM_STATUSES.join(',')})`);
    for (const status of OFFLINE_GYM_STATUSES) expect(gymIsOffline(status)).toBe(true);
  });
});

// Every way a stranger, a member or a scheduled job can turn a slug / member
// code / gym id into a gym. Each must exclude switched-off tenants. Adding a
// new public gym resolver means adding it here — the point of the list is that
// the omission is the bug, so it has to be visible somewhere.
const RESOLVERS: Array<{ file: string; why: string }> = [
  { file: 'lib/gym-signup.ts', why: 'mobile API: /api/app/gym, /api/app/signup, /api/app/signin' },
  { file: 'lib/actions/join.ts', why: 'web join flow — creates real members' },
  { file: 'app/login/page.tsx', why: 'gym-branded sign-in on the subdomain' },
  { file: 'app/sitemap.ts', why: 'hands tenant URLs to crawlers' },
  { file: 'app/api/cron/route.ts', why: 'nightly gym-branded email + WhatsApp' },
];

describe('public gym resolvers exclude switched-off tenants', () => {
  it.each(RESOLVERS)('$file filters offline gyms ($why)', ({ file }) => {
    const src = read(file);
    expect(src).toContain('OFFLINE_GYM_FILTER');
    // Every `.from('gyms')` select in these files must carry the filter, unless
    // it is explicitly marked exempt on the line above. The marker is there so
    // a query that genuinely resolves no gym (a head-only keep-warm count) can
    // opt out in the open, rather than the rule being loosened for everyone.
    const selects = (src.match(/\.from\('gyms'\)/g) ?? []).length;
    const exempt = (src.match(/gym-status: n\/a/g) ?? []).length;
    const filters = (src.match(/\.not\('status', 'in', OFFLINE_GYM_FILTER\)/g) ?? []).length;
    expect(selects).toBeGreaterThan(0);
    expect(filters + exempt).toBe(selects);
  });
});

// The render guards. These do not need the query filter (they already hold the
// row), but they must go through the shared predicate rather than an inline
// comparison — the inline spelling is what let `terminated` stay online
// everywhere while `suspended` was handled.
const GUARDS = [
  'app/g/[slug]/page.tsx',
  'app/g/[slug]/join-qr/route.ts',
  'app/print-qr/[slug]/page.tsx',
  'app/(admin)/layout.tsx',
  'app/(member)/layout.tsx',
  'app/(coach)/layout.tsx',
  'app/join/[slug]/page.tsx',
  'app/api/cron/backups/route.ts',
  'lib/actions/renew.ts',
  'lib/actions/member-billing.ts',
  'lib/actions/checkin.ts',
];

describe('gym-status guards use the shared predicate', () => {
  it.each(GUARDS)('%s calls isOfflineGym', (file) => {
    expect(read(file)).toContain('isOfflineGym(');
  });

  it.each(GUARDS)('%s has no inline status comparison left', (file) => {
    expect(read(file)).not.toMatch(/status\s*[!=]==\s*'suspended'/);
  });
});

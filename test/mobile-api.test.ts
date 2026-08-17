import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Android member app (mobile/) reaches this platform through /api/app/*,
// and nothing else. That makes this directory a second front door to every
// member's data — one that does not go through the (member) layout, the
// middleware's cookie session, or any of the Server Action machinery the web
// surfaces are protected by.
//
// Two properties have to hold for that door to be as safe as the web one, and
// neither is visible in any single file:
//
//   1. Every endpoint that touches member data authenticates the caller with
//      requireApiMember(), which resolves the member from their own JWT and
//      hands back an RLS-scoped client.
//   2. Endpoints do NOT reimplement the rules the web enforces. Check-in gates,
//      class capacity and renewal pricing come from the shared cores, so a
//      lapsed membership is refused identically on both runtimes.
//
// Both were true when this app shipped. This test is what makes them stay true
// when the next endpoint is added.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');

const API_DIR = 'app/api/app';

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root(dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(root(rel)).isDirectory()) out.push(...routeFiles(rel));
    else if (entry === 'route.ts') out.push(rel);
  }
  return out.sort();
}

// Endpoints that are unauthenticated ON PURPOSE. Each needs a reason, because
// adding a line here is how an endpoint stops being protected — the entry
// should be hard to write without noticing what it means.
const PUBLIC_ROUTES: Record<string, string> = {
  'app/api/app/gym/route.ts':
    'resolves a gym from its member code before anyone has signed in; returns public branding only',
  'app/api/app/signin/route.ts':
    'mints the session — the password IS the credential; rate-limited per IP and per email',
  'app/api/app/signup/route.ts':
    'creates the account; rate-limited, and resolveGymByCode refuses switched-off tenants',
  'app/api/app/session/route.ts':
    'exchanges a refresh token whose access token has, by definition, expired',
  'app/api/app/pay/callback/route.ts':
    'Paystack redirects a browser here with no app session; the reference is verified against Paystack and fulfilled from server-set metadata',
};

const routes = routeFiles(API_DIR);

describe('/api/app surface', () => {
  it('has routes to check', () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it.each(routes)('%s is authenticated, or listed as public with a reason', (file) => {
    const src = read(file);
    const why = PUBLIC_ROUTES[file];
    if (why) {
      expect(why.length).toBeGreaterThan(20);
      return;
    }
    expect(src).toContain('requireApiMember(req)');
    // The auth result is a discriminated union precisely so a route cannot read
    // the member without handling the failure branch. Returning `auth.res` is
    // that handling; skipping it would mean reading ctx off a failed auth.
    expect(src).toContain('if (!auth.ok) return auth.res');
  });

  it.each(routes.filter((f) => !PUBLIC_ROUTES[f]))('%s does not bypass RLS with the service role', (file) => {
    // Authenticated endpoints run on the member's own token, which is what makes
    // RLS the authority on what they can see. A service-role client here would
    // silently switch that off for every query in the file. (The shared cores
    // do use it — for capacity counts and waitlist promotion across other
    // members' rows — but that is scoped to those functions and reviewed there.)
    expect(read(file)).not.toContain('@/lib/supabase/admin');
  });
});

// One implementation, two callers. The pairs below are the rules that decide
// whether a member gets through the door, into a class, or into a checkout —
// the three places where a divergence between web and mobile is not a cosmetic
// bug but a member being let in unpaid, double-booked into a full class, or
// charged the wrong amount.
const SHARED_CORES: Array<{ core: string; action: string; route: string; why: string }> = [
  {
    core: '@/lib/checkin-core',
    action: 'lib/actions/checkin.ts',
    route: 'app/api/app/checkin/route.ts',
    why: 'entry gates: suspended member, lapsed subscription, gym switched off',
  },
  {
    core: '@/lib/booking-core',
    action: 'lib/actions/booking.ts',
    route: 'app/api/app/classes/route.ts',
    why: 'class capacity, waitlisting and waitlist promotion',
  },
  {
    core: '@/lib/renew-core',
    action: 'lib/actions/renew.ts',
    route: 'app/api/app/renew/route.ts',
    why: 'plan pricing, the trainer add-on, and refusing checkouts for offline gyms',
  },
];

describe('web and mobile share one implementation of the member rules', () => {
  it.each(SHARED_CORES)('$core is the only source for $why', ({ core, action, route }) => {
    expect(read(action)).toContain(core);
    expect(read(route)).toContain(core);
  });

  it.each(SHARED_CORES)('$action holds no copy of the rules', ({ action }) => {
    // A Server Action wrapper's whole job is to resolve the caller from cookies
    // and invalidate caches. The moment one starts querying the membership or
    // booking tables itself, the web has a rule the phone doesn't.
    const src = read(action);
    expect(src).not.toContain(".from('member_subscriptions')");
    expect(src).not.toContain(".from('class_bookings')");
    expect(src).not.toContain(".from('membership_plans')");
  });

  it.each(SHARED_CORES)('$route writes nothing itself', ({ route }) => {
    // The route may read to render (the timetable, a member's own bookings),
    // but every WRITE goes through the core — that is where the gate that
    // precedes the write lives. A direct .insert()/.update() here would be a
    // check-in or a booking that skipped it.
    const src = read(route);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
  });
});

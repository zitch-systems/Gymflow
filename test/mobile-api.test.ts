import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gymCanUse, gymHasFeature } from '@/lib/entitlements';
import { planLocked } from '@/lib/api-app';

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


// ── The plan gate ───────────────────────────────────────────────────────────
// Starter is the gym's own admin portal; the member app is a Growth surface
// (lib/entitlements.ts). The web PWA is walled by app/(member)/layout.tsx — a
// React layout, and a layout is chrome: it never runs for a route handler and
// never runs for a Server Action POST.
//
// So the gate has to be written out again on both server-side doors, or a gym
// that signed up as Starter after the repositioning gets the lock wall in its
// own browser and the full Growth experience on the shipped Android app. Same
// member, same account, opposite answers depending on the door.

// The endpoints that turn a member code into a gym before anyone has a token.
// requireApiMember cannot cover them — that is the whole reason they are in
// PUBLIC_ROUTES — so each carries the gate itself.
//
// /api/app/gym is deliberately absent: it refuses a plan-locked gym the same
// way it refuses an unknown code, so it has no planLocked() call to assert.
// See its own test below.
const CODE_ROUTES = [
  'app/api/app/signin/route.ts',
  'app/api/app/signup/route.ts',
];

// The member-facing Server Actions. Web entry points, but the same defect: the
// only member_app gate on the web is the layout, which an action POST bypasses.
const MEMBER_ACTIONS = [
  'lib/actions/checkin.ts',
  'lib/actions/renew.ts',
  'lib/actions/booking.ts',
  'lib/actions/member-billing.ts',
];

describe('member surfaces are gated on the gym plan', () => {
  it('gymCanUse is the policy: post-repositioning Starter out, legacy Starter and Growth in', () => {
    const starter = { subscription_plan: 'starter', legacy_full_access: false };
    const legacy = { subscription_plan: 'starter', legacy_full_access: true };
    const growth = { subscription_plan: 'growth', legacy_full_access: false };
    for (const feature of ['member_app', 'qr_checkin'] as const) {
      expect(gymCanUse(starter, feature)).toBe(false);
      expect(gymCanUse(legacy, feature)).toBe(true);
      expect(gymCanUse(growth, feature)).toBe(true);
    }
    // Class scheduling predates the repositioning, so the grandfather must not
    // reach it — which is why the booking branch uses gymHasFeature instead.
    expect(gymHasFeature(legacy, 'class_scheduling')).toBe(false);
    expect(gymHasFeature(growth, 'class_scheduling')).toBe(true);
  });

  it('requireApiMember refuses a locked gym, closing all of /api/app at once', () => {
    const src = read('lib/api-app.ts');
    expect(src).toContain("gymCanUse(gym, 'member_app')");
    // gymHasFeature here would cut off every gym that existed before the
    // repositioning — exactly what gyms.legacy_full_access exists to prevent.
    expect(src).not.toContain("gymHasFeature(gym, 'member_app')");
  });

  it('the refusal is a 403 the app can tell apart from an auth failure', async () => {
    const res = planLocked('Iron Republic', 'the member app');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    // Its own code: 'expired' means refresh the token, 'not_a_member' means
    // wrong account, and mobile/src/api/client.ts routes 401s into a re-auth.
    // This is neither — the member is fine, the gym's plan is not.
    expect(body.code).toBe('plan_locked');
    // The app has no wall to render; it shows `error` verbatim, so the sentence
    // has to name the gym and be something a member can act on.
    expect(body.error).toContain('Iron Republic');
  });

  it.each(CODE_ROUTES)('%s gates the gym it resolved from the member code', (file) => {
    const src = read(file);
    expect(src).toContain('resolveGymByCode');
    expect(src).toContain("gymCanUse(gym, 'member_app')");
    expect(src).toContain('planLocked(');
  });

  it('the unauthenticated code lookup gates WITHOUT disclosing that the plan is why', () => {
    // /api/app/gym takes nothing but a member code — no caller identity at all.
    // A distinguishable refusal there would publish "which gyms pay GymFlow for
    // what", with the gym's own name attached, to anyone holding a code. So a
    // plan-locked gym is answered exactly as an unknown code is, and the route
    // has no planLocked() call to make the difference visible.
    const src = read('app/api/app/gym/route.ts');
    expect(src).toContain("gymCanUse(gym, 'member_app')");
    expect(src).not.toContain('planLocked');
    // Both refusals collapse into the one 404 sentence.
    expect(src).toContain('No gym found for that code.');
    // And it throttles like signin/signup do — a member code is a short string
    // an unauthenticated caller can guess at, and this is the cheapest oracle.
    expect(src).toContain('rateLimit(');
  });

  it('signup refuses before it enrols anyone', () => {
    // Signup links the account into the gym. Order matters: a member
    // provisioned into a gym whose app they cannot open is a worse outcome than
    // being turned away at the code.
    const src = read('app/api/app/signup/route.ts');
    expect(src.indexOf("gymCanUse(gym, 'member_app')")).toBeLessThan(src.indexOf('provisionMember('));
  });

  it('signin never enrols anyone', () => {
    // Gym member codes are printed on flyers and embedded in /g/[slug]/join-qr,
    // so a signin that provisions would let any signed-in user attach
    // themselves as an active member of an arbitrary gym just by typing its
    // public code. Signin verifies an EXISTING link and refuses otherwise;
    // joining is the signup flow's job.
    const src = read('app/api/app/signin/route.ts');
    expect(src).not.toContain('provisionMember(');
    expect(src).toContain('gym_member_links');
  });

  it('signup never service-role-confirms a public account', () => {
    // Confirming an address the caller has not proven they own lets anyone
    // mint and immediately control an account for someone else's email. The
    // web /join flow observes the same boundary.
    const src = read('app/api/app/signup/route.ts');
    expect(src).not.toContain('auth.admin.updateUserById');
    expect(src).not.toContain('createAdminClient');
  });

  it('check-in gates entry on qr_checkin, its own feature', () => {
    expect(read('app/api/app/checkin/route.ts')).toContain("gymCanUse(gym, 'qr_checkin')");
  });

  it('class booking gates on class_scheduling, which the grandfather must not widen into', () => {
    const src = read('app/api/app/classes/route.ts');
    expect(src).toContain("gymHasFeature(gym, 'class_scheduling')");
    expect(src).not.toContain("gymCanUse(gym, 'class_scheduling')");
  });

  it.each(MEMBER_ACTIONS)('%s carries the gate too — a layout does not run for an action POST', (file) => {
    const src = read(file);
    expect(src).toContain("gymCanUse(gym, 'member_app')");
    expect(src).toContain('memberLockedMessage(');
  });
});

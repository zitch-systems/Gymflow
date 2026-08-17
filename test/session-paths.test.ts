import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsSession } from '../lib/session-paths';

// The middleware is the only thing that can refresh an expiring auth cookie —
// Server Components can't write cookies. A gated surface missing from
// needsSession() therefore fails in the least visible way available: it works
// perfectly for an hour, then starts bouncing people to a sign-in page with no
// explanation, and only for whoever happened to leave a tab open.
//
// That is not hypothetical. The platform console lost its refresh when the
// middleware's static matcher was replaced by a function and
// '/superadmin/:path*' didn't survive the move. This file is why that can't
// happen again quietly.

// Every route group that sits behind an auth gate, and the URL it answers on.
const GATED = [
  { group: '(member)', path: '/dashboard' },
  { group: '(member)', path: '/checkin' },
  { group: '(member)', path: '/classes' },
  { group: '(admin)', path: '/admin' },
  { group: '(coach)', path: '/coach' },
  { group: '(superadmin)', path: '/superadmin' },
];

describe('needsSession covers every gated surface', () => {
  it.each(GATED)('$path ($group) refreshes the session', ({ path }) => {
    expect(needsSession(path)).toBe(true);
    // Children too: a deep link like /classes/<id> or /superadmin/gyms/<id> is
    // where an idle tab usually lands, and it needs the refresh most.
    expect(needsSession(`${path}/anything`)).toBe(true);
    expect(needsSession(`${path}/nested/deeper`)).toBe(true);
  });

  it('covers the auth routes that read a session', () => {
    for (const p of ['/login', '/signup', '/forgot-password', '/reset-password', '/launch']) {
      expect(needsSession(p)).toBe(true);
    }
  });

  it('leaves the public surface alone, so it pays no auth round-trip', () => {
    for (const p of ['/', '/pricing', '/features', '/about', '/contact', '/legal', '/gallery', '/g/iron-republic']) {
      expect(needsSession(p)).toBe(false);
    }
  });

  it('does not match a path that merely starts with a gated one', () => {
    // /admin-help is not /admin. A startsWith() without the boundary would
    // quietly widen this to every path sharing a prefix.
    expect(needsSession('/admins')).toBe(false);
    expect(needsSession('/admin-help')).toBe(false);
    expect(needsSession('/superadmin-help')).toBe(false);
    expect(needsSession('/classesx')).toBe(false);
  });

  it('leaves /auth/confirm out on purpose', () => {
    // It has no session until its route redeems the email token; refreshing
    // first only adds a round-trip to the most latency-sensitive flow.
    expect(needsSession('/auth/confirm')).toBe(false);
  });
});

// A route group added later is a surface that needs deciding about. This finds
// the groups on disk so a new gated one can't be added without either landing
// in GATED above or failing here.
describe('the gated group list is complete', () => {
  it('knows about every (group) in app/', () => {
    const groups = readdirSync(resolve(__dirname, '..', 'app'))
      .filter((e) => e.startsWith('(') && e.endsWith(')'))
      .filter((e) => statSync(resolve(__dirname, '..', 'app', e)).isDirectory());

    // Groups that are deliberately NOT session-refreshed, with the reason.
    const ungated: Record<string, string> = {
      // The console's own sign-in. Reachable signed-out by definition; its
      // sibling group (superadmin) is the gated one.
      '(superadmin-auth)': 'sign-in page, no session to refresh',
    };

    const known = new Set([...GATED.map((g) => g.group), ...Object.keys(ungated)]);
    const unknown = groups.filter((g) => !known.has(g));
    expect(unknown).toEqual([]);
  });
});

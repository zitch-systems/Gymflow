import { SUPERADMIN_ROUTE } from '@/lib/superadmin-path';

// Which paths need the middleware to refresh an expiring auth cookie.
//
// Server Components can't write cookies, so this is the only place a session
// gets renewed. A gated surface missing from this list doesn't fail loudly —
// it works perfectly until someone's access token ages out, and then bounces
// them to a sign-in page for no visible reason. That is exactly what happened
// to the platform console when the middleware's static matcher was replaced by
// a function and `/superadmin/:path*` didn't make the move, so the list now
// lives here, next to a test that checks every gated surface is on it.
//
// Everything else — marketing, /api/*, the public gym landing — returns from
// the middleware immediately and pays no auth round-trip.

/** Exact paths (no children) that read the session. */
export const SESSION_EXACT = ['/login', '/signup', '/forgot-password', '/reset-password', '/launch'] as const;

/**
 * Gated surfaces: the root itself and everything beneath it.
 *
 * Children matter as much as roots — member deep links like /classes/<id> and
 * /checkin/* need the refresh too, or an idle token isn't renewed there and
 * getUser() spuriously bounces the member to /login.
 */
export const SESSION_TREES = [
  '/dashboard', '/checkin', '/classes', '/join', '/billing', '/admin', '/coach',
  // The platform console's INTERNAL route. Reached either directly (when no
  // SUPERADMIN_PATH is configured) or as the middleware's rewrite target; the
  // rewrite path refreshes the session itself, so this entry is what covers the
  // fallback.
  SUPERADMIN_ROUTE,
] as const;

/**
 * /auth/confirm is deliberately absent: it has no session until its route
 * redeems the email token, so refreshing first would only add a round-trip to
 * the most latency-sensitive flow in the app.
 */
export function needsSession(pathname: string): boolean {
  if ((SESSION_EXACT as readonly string[]).includes(pathname)) return true;
  return (SESSION_TREES as readonly string[]).some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

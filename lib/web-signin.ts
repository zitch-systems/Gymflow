import type { Route } from 'next';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { gymUrl } from '@/lib/email/brand';

// Which sign-in belongs on which host.
//
// GymFlow's website (gymflow.ng) is the product's own front door: marketing,
// owner signup, and the console the gym's staff run their business from. A gym's
// members are not customers of gymflow.ng — they're customers of the gym, and
// their front door is the gym's own page, <slug>.gymflow.ng, which already
// carries that gym's name, logo and colours.
//
// So a member who authenticates on the apex is not rejected, and certainly not
// told their password is wrong. They're sent one hop sideways, to the same
// sign-in dressed in their gym's brand. The Android app is the other way in;
// neither is affected by this rule.
//
// Precedence, and why: staff win over members. A gym owner who also trains at
// their own gym holds both a staff link and a member link, and they need the
// console — sending them to the member sign-in would lock them out of the
// business they own.

/**
 * Is this request on GymFlow's own website, as opposed to a gym's page?
 *
 * True only for the real apex (and www). Deliberately false for localhost,
 * 127.0.0.1 and *.vercel.app previews: subdomains don't resolve there, so
 * enforcing this rule would strand every member in development with nowhere to
 * be redirected to.
 */
export function isPlatformWebsite(host: string | null | undefined): boolean {
  const h = (host ?? '').split(':')[0].toLowerCase();
  if (!h) return false;
  return h === ROOT_DOMAIN || h === `www.${ROOT_DOMAIN}`;
}

/** A gym's own sign-in page: https://<slug>.gymflow.ng/login */
export function gymSignInUrl(slug: string | null | undefined): string {
  return `${gymUrl(slug)}/login`;
}

/**
 * A gym's role router. Sends a member to their dashboard, and anyone signed out
 * to that gym's sign-in — so it's the right target whether or not the browser
 * already holds a session on that host.
 *
 * Typed as `Route` for `redirect()`. typedRoutes checks hrefs against this
 * app's own route tree, and a gym's host is a different origin — correct at
 * runtime (redirect takes absolute URLs), unknowable at build time.
 */
export function gymLaunchUrl(slug: string | null | undefined): Route {
  return `${gymUrl(slug)}/launch` as Route;
}

export type SignInRoles = {
  isPlatformAdmin: boolean;
  isStaff: boolean;
  /** The gym they're a member of, when they are one. */
  memberGymSlug: string | null;
};

/**
 * Does this person belong on their gym's page rather than this one?
 *
 * Returns null when they may stay — which covers every case except the one it
 * exists for: a member-only account, on the platform's own website, whose gym
 * we can actually name. A member whose gym has no usable slug is left alone;
 * there is nowhere to send them, and a redirect to a URL that doesn't resolve
 * is worse than the status quo.
 */
export function memberBelongsOnGymSite(host: string | null | undefined, roles: SignInRoles): boolean {
  if (!isPlatformWebsite(host)) return false;
  if (roles.isPlatformAdmin || roles.isStaff) return false;
  const slug = (roles.memberGymSlug ?? '').trim();
  return /^[a-z0-9-]+$/.test(slug);
}

// Tenant (gym subdomain) resolution shared by the edge middleware and server
// components. Gym tenants live at <slug>.<root>; the apex and reserved labels
// are the platform (marketing + owner onboarding), not a gym.

// Production root domain. Overridable so staging/custom domains work; falls
// back to the public site host, then gymflow.ng.
export const ROOT_DOMAIN = (
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ||
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') ||
  'gymflow.ng'
).toLowerCase();

// Subdomains that are never a gym tenant.
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'dashboard', 'mail', 'static', 'assets', 'cdn', 'staging']);

/**
 * The absolute origin a redirect back from an external service (Paystack) must
 * target: the host the user is actually on.
 *
 * Every callback URL used to be built from NEXT_PUBLIC_SITE_URL — the apex. A
 * member browsing iron-republic.gymflow.ng who paid was returned to
 * gymflow.ng/dashboard/renew/callback, where their session did not exist:
 * Supabase auth cookies are host-only, so the apex saw a signed-out visitor and
 * requireMember() redirected them to the GymFlow login page. They had paid, and
 * the app appeared to log them out.
 *
 * Falls back to the configured site URL when the host isn't one of ours, so a
 * spoofed Host header can't turn our own checkout into a redirect to somewhere
 * else. Pure, so the host rules are testable without a request.
 */
export function originForHost(host: string | null, proto: string | null, fallbackSiteUrl: string | undefined): string {
  const fallback = (fallbackSiteUrl ?? '').replace(/\/+$/, '');
  if (!host) return fallback;
  const h = host.split(':')[0].toLowerCase();

  const isOurs =
    h === ROOT_DOMAIN || h.endsWith(`.${ROOT_DOMAIN}`)
    // Dev and preview deploys are legitimately on other hosts, and returning to
    // the apex from either would land the user on production.
    || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
  if (!isOurs) return fallback;

  const scheme = proto?.split(',')[0].trim() || (h === 'localhost' || h === '127.0.0.1' ? 'http' : 'https');
  return `${scheme}://${host}`;
}

// Resolve a gym slug from the request host, or null if this isn't a gym tenant
// (apex domain, www, a reserved label, *.vercel.app preview, localhost, …).
export function gymSlugFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.split(':')[0].toLowerCase();
  if (h === ROOT_DOMAIN || h === `www.${ROOT_DOMAIN}`) return null;
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null; // not our domain (preview hosts, localhost)
  const sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
  if (!sub || sub.includes('.')) return null; // empty or multi-level
  if (RESERVED.has(sub)) return null;
  return sub;
}

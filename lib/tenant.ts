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

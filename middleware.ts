import { NextResponse, type NextRequest } from 'next/server';
import { hasSessionCookie, updateSession } from '@/lib/supabase/middleware';

// Production root domain. Gym tenants live at <slug>.<root>. Overridable so
// staging/custom domains work; falls back to the public site host, then gymflow.ng.
const ROOT_DOMAIN = (
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ||
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') ||
  'gymflow.ng'
).toLowerCase();

// Subdomains that are never a gym tenant.
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'dashboard', 'mail', 'static', 'assets', 'cdn', 'staging']);

// Resolve a gym slug from the request host, or null if this isn't a gym tenant
// (apex domain, www, a reserved label, *.vercel.app preview, localhost, …).
function gymSlugFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.split(':')[0].toLowerCase();
  if (h === ROOT_DOMAIN || h === `www.${ROOT_DOMAIN}`) return null;
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null; // not our domain (preview hosts, localhost)
  const sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
  if (!sub || sub.includes('.')) return null; // empty or multi-level
  if (RESERVED.has(sub)) return null;
  return sub;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const slug = gymSlugFromHost(request.headers.get('host'));

  // Gym tenant root → the gym's branded landing page. Every other path on the
  // subdomain (login, dashboard, …) is host-agnostic and passes through.
  if (slug && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = `/g/${slug}`;
    return NextResponse.rewrite(url);
  }

  // Apex/marketing home reads no session — skip the auth round-trip.
  if (pathname === '/') return NextResponse.next();

  // Anonymous hit on a gated surface → proper 307 to /login before any HTML
  // streams. The layouts stream their shells now (for instant tap feedback),
  // so they can no longer set an early redirect status themselves; without
  // this, a signed-out request would get a 200 skeleton before the page
  // gate's client-side redirect kicked in. Zero network cost — a cookie check.
  if (GATED_RE.test(pathname) && !hasSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return updateSession(request);
}

// Every route group whose layout/pages require a signed-in user. /join and the
// auth pages are public; /launch redirects signed-out users itself but is
// included since it needs a session to do anything useful.
const GATED_RE = /^\/(dashboard|classes|checkin|admin|coach|superadmin|billing|launch)(\/|$)/;

// Runs on the home route (for the subdomain rewrite) and on the auth-dependent
// routes (for session refresh). Marketing pages and /api/* are excluded — those
// never read the session, so an auth.getUser() round-trip there is pure latency.
export const config = {
  matcher: [
    '/',
    '/login', '/signup', '/forgot-password', '/reset-password', '/auth/confirm',
    '/launch',
    '/dashboard/:path*',
    '/checkin', '/classes',
    '/join/:path*',
    '/billing/:path*',
    '/admin/:path*',
    '/coach/:path*',
    '/superadmin/:path*',
  ],
};

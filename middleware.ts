import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

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

  return updateSession(request);
}

// Runs on the home route (for the subdomain rewrite) and on the auth-dependent
// routes (for session refresh). Marketing pages and /api/* are excluded — those
// never read the session, so an auth.getUser() round-trip there is pure latency.
export const config = {
  matcher: [
    '/',
    '/login', '/signup', '/forgot-password', '/reset-password',
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

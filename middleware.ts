import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { gymSlugFromHost, ROOT_DOMAIN } from '@/lib/tenant';
import { hasCustomSegment, internalPathFor, isDirectRouteHit, superadminSegment } from '@/lib/superadmin-path';

// Paths whose pages read the session, so an expiring cookie must be refreshed
// here (Server Components can't write cookies). Everything else returns
// immediately: the auth round-trip on a marketing page is pure latency.
//
// This list used to BE the matcher below. It moved into the function because
// the platform console now answers on a secret, env-configured segment
// (SUPERADMIN_PATH) — and Next requires `config.matcher` to be statically
// analysable, so a matcher can't name a path that is only known at runtime.
// The cost is that middleware is invoked on marketing pages too; the expensive
// part (auth.getUser) is still skipped for them.
const SESSION_EXACT = new Set(['/login', '/signup', '/forgot-password', '/reset-password', '/launch']);
const SESSION_PREFIXES = [
  // :path* (not exact) so member deep links like /classes/<id> and /checkin/*
  // still get their session refreshed — otherwise an idle token isn't renewed
  // there and getUser() spuriously bounces the member to /login.
  '/dashboard/', '/checkin/', '/classes/', '/join/', '/billing/', '/admin/', '/coach/',
];
const SESSION_ROOTS = ['/dashboard', '/checkin', '/classes', '/join', '/billing', '/admin', '/coach'];

// Rewriting here renders the app's own not-found page with a 404, so a probe of
// the retired /superadmin URL is byte-for-byte what any made-up path returns.
// A bare `new NextResponse(null, { status: 404 })` would answer with an empty
// body no other path produces — which is itself a signal that something is
// there. The path must not exist as a route.
const NOT_FOUND_PATH = '/gf-not-found';

function needsSession(pathname: string): boolean {
  if (SESSION_EXACT.has(pathname)) return true;
  if (SESSION_ROOTS.includes(pathname)) return true;
  return SESSION_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get('host');
  const slug = gymSlugFromHost(host);

  // Gym tenant root → the gym's branded landing page. Every other path on the
  // subdomain (login, dashboard, …) is host-agnostic and passes through.
  if (slug && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = `/g/${slug}`;
    return NextResponse.rewrite(url);
  }

  // Consolidate the duplicate landing URL: the same page is reachable at the
  // apex path /g/<slug> and at <slug>.<root>/. The landing's canonical already
  // points at the subdomain; 308-redirect the apex path there so humans and
  // bots converge on one URL. Only on the real apex host — on localhost/preview
  // (and on the subdomain itself, where /g/* only appears via internal rewrite)
  // subdomains don't resolve, so we must not redirect.
  if (!slug && pathname.startsWith('/g/')) {
    const h = (host ?? '').split(':')[0].toLowerCase();
    if (h === ROOT_DOMAIN || h === `www.${ROOT_DOMAIN}`) {
      const gymSlug = pathname.split('/')[2];
      if (gymSlug) {
        return NextResponse.redirect(`https://${gymSlug}.${ROOT_DOMAIN}/`, 308);
      }
    }
    // Public landing on a non-apex host (preview/local): no session to refresh.
    return NextResponse.next();
  }

  // ── The platform console's secret door ───────────────────────────────────
  // Only when a custom segment is configured; with SUPERADMIN_PATH unset the
  // console stays at /superadmin and neither branch below does anything.
  if (hasCustomSegment()) {
    const internal = internalPathFor(pathname, superadminSegment());
    if (internal) {
      // Rewrite, not redirect: a redirect would put the internal path in the
      // browser's address bar, where the block below then 404s it. The console
      // reads the session on every page, so the refresh rides along — see
      // updateSession's rewriteTo.
      const url = request.nextUrl.clone();
      url.pathname = internal;
      return updateSession(request, url);
    }
    // The retired URL. Not a redirect to the new one, obviously — that would
    // hand the secret to whoever knocked.
    if (isDirectRouteHit(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = NOT_FOUND_PATH;
      url.search = '';
      return NextResponse.rewrite(url);
    }
  }

  if (!needsSession(pathname)) return NextResponse.next();

  return updateSession(request);
}

// Everything except static assets and /api/*.
//
// Broader than it needs to be for its own sake: the console's public segment is
// configured at runtime, and a static matcher cannot name it. `needsSession()`
// above keeps the behaviour that mattered — marketing pages and API routes still
// pay no auth round-trip, they just now pass through an edge invocation first.
//
// /auth/confirm is deliberately session-free: it has no session until its route
// redeems the email token, so a getUser() first would only add a round-trip to
// the most latency-sensitive flow. It falls out of needsSession() by omission.
export const config = {
  matcher: [
    '/((?!api/|_next/static|_next/image|_next/data|favicon\\.ico|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|sw\\.js|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|map|txt|xml|json|woff2?|ttf)$).*)',
  ],
};

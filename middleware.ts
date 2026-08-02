import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { gymSlugFromHost, ROOT_DOMAIN } from '@/lib/tenant';

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
    // Apex /g/<slug> → subdomain 308 (the rewrite path is internal, so this
    // only ever matches an external apex request, never the subdomain itself).
    '/g/:path*',
    // /auth/confirm is intentionally excluded: it has no session until its
    // route redeems the email token/code. A middleware getUser() first only
    // adds a second auth-network round trip to the most latency-sensitive flow.
    '/login', '/signup', '/forgot-password', '/reset-password',
    '/launch',
    '/dashboard/:path*',
    // :path* (not exact) so member deep links like /classes/<id> and /checkin/*
    // still get their session refreshed — otherwise an idle token isn't renewed
    // there and getUser() spuriously bounces the member to /login.
    '/checkin/:path*', '/classes/:path*',
    '/join/:path*',
    '/billing/:path*',
    '/admin/:path*',
    '/coach/:path*',
    '/superadmin/:path*',
  ],
};

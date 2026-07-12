import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { gymSlugFromHost } from '@/lib/tenant';

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

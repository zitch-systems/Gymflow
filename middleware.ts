import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Keeps the Supabase session fresh on protected requests. (Subdomain → gym
// routing can be layered in here later; for now auth-session refresh is the job.)
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Only run on paths that read or depend on auth. Marketing routes (/, /features,
// /about, /pricing, /contact, /careers, /legal, /gallery) previously triggered
// an `auth.getUser()` round-trip on every visit — pure latency, since those
// pages never read the session. A logged-in user who lands on a marketing page
// won't get a session refresh from that hit, but the next protected-route
// navigation refreshes it before any RLS-scoped query runs, so it's invisible
// in practice. /api/* is excluded too: the API routes authenticate via HMAC
// (Paystack webhook) or a shared secret (cron), not auth cookies.
export const config = {
  matcher: [
    '/login', '/signup', '/forgot-password', '/reset-password',
    '/launch',
    '/dashboard/:path*',
    '/checkin', '/classes',
    '/join/:path*',
    '/admin/:path*',
    '/coach/:path*',
    '/superadmin/:path*',
  ],
};

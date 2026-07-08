import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/database.types';

// @supabase/ssr session cookie: sb-<ref>-auth-token, possibly split into
// sb-<ref>-auth-token.0 / .1 chunks when the payload exceeds the cookie limit.
const AUTH_COOKIE_RE = /^sb-.+-auth-token(?:\.\d+)?$/;

// Whether the request carries any Supabase session cookie at all. Used by the
// middleware to 307 anonymous hits on gated routes straight to /login (the
// streamed layouts can no longer return an early redirect status themselves).
export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => AUTH_COOKIE_RE.test(c.name));
}

// Refresh the token this long before it actually expires, so Server Components
// (which cannot write cookies) never see an expired access token.
const REFRESH_MARGIN_S = 300;

// Read expires_at (unix seconds) out of the session cookie without a network
// call. Returns null when it can't be determined — callers must then fall back
// to the real getUser() refresh.
function sessionExpiresAt(request: NextRequest): number | null {
  try {
    const chunks = request.cookies
      .getAll()
      .filter((c) => AUTH_COOKIE_RE.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (chunks.length === 0) return null;
    let raw = chunks.map((c) => c.value).join('');
    if (raw.startsWith('base64-')) {
      const b64 = raw.slice(7).replace(/-/g, '+').replace(/_/g, '/');
      raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    }
    const session = JSON.parse(raw) as { expires_at?: number };
    return typeof session.expires_at === 'number' ? session.expires_at : null;
  } catch {
    return null;
  }
}

// Refreshes the Supabase auth session and forwards the updated cookies to both
// the browser and downstream Server Components (standard @supabase/ssr pattern)
// — but only when there is actually a session that needs refreshing. The
// middleware is NOT the auth gate (every protected layout revalidates through
// lib/auth/dal.ts getUser()); its only job is rotating soon-to-expire tokens.
// Skipping the network round-trip for anonymous requests and fresh tokens
// removes a blocking Supabase Auth call from almost every navigation.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // No env (e.g. CI build without secrets) → skip auth, just pass through.
  if (!url || !key) return response;

  // Anonymous request (no session cookie at all) → nothing to refresh.
  const hasSession = request.cookies.getAll().some((c) => AUTH_COOKIE_RE.test(c.name));
  if (!hasSession) return response;

  // Token comfortably fresh → skip the round-trip. The DAL's getUser() remains
  // the authoritative check; a forged or revoked token still fails there.
  const expiresAt = sessionExpiresAt(request);
  if (expiresAt !== null && expiresAt - Date.now() / 1000 > REFRESH_MARGIN_S) return response;

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: getUser() (not getSession) revalidates the token with Supabase
  // and rotates it via the cookie setters above.
  await supabase.auth.getUser();

  return response;
}

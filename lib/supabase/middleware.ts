import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/database.types';

// The middleware's only job is refreshing an expiring session cookie (Server
// Components can't write cookies). When the access token in the cookie still
// has plenty of life left there is nothing to refresh, so the network
// round-trip to the Supabase auth server would be pure latency on every
// navigation. Security is unaffected: every protected page still validates the
// token server-side via the DAL's supabase.auth.getUser().
const REFRESH_BUFFER_S = 300; // refresh when < 5 min of a (typically 1 h) token remains

function tokenFreshFor(request: NextRequest): boolean {
  try {
    // @supabase/ssr stores the session as sb-<ref>-auth-token, chunked into
    // .0/.1/… suffixes when large, base64url-encoded JSON with a "base64-" prefix.
    const chunks = request.cookies
      .getAll()
      .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (chunks.length === 0) return false;
    let raw = chunks.map((c) => c.value).join('');
    if (raw.startsWith('base64-')) {
      // base64url, unpadded (edge runtime: atob, not Buffer)
      const b64 = raw.slice(7).replace(/-/g, '+').replace(/_/g, '/');
      raw = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
    }
    const session = JSON.parse(raw) as { expires_at?: number };
    if (typeof session.expires_at !== 'number') return false;
    return session.expires_at - Math.floor(Date.now() / 1000) > REFRESH_BUFFER_S;
  } catch {
    return false; // unparseable → fall through to the full refresh path
  }
}

// Refreshes the Supabase auth session when it's near expiry and forwards the
// updated cookies to both the browser and downstream Server Components.
// Standard @supabase/ssr middleware pattern, with a freshness fast-path.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // No env (e.g. CI build without secrets) → skip auth, just pass through.
  if (!url || !key) return response;

  // Fast path: token comfortably valid → no auth round-trip, no cookie writes.
  if (tokenFreshFor(request)) return response;

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

  // IMPORTANT: getUser() (not getSession) revalidates the token with Supabase.
  await supabase.auth.getUser();

  return response;
}

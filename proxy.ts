import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Slug pattern enforced at signup; mirroring it here keeps obviously-bogus
// subdomain probes from being rewritten into the tenant tree.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();

  // Skip API, static files, and Supabase auth callbacks
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // ── Supabase session refresh ──────────────────────────────────────────
  // Access tokens expire (~1h). Without this, SSR sees stale auth even with a
  // valid refresh token and users get spuriously logged out mid-session.
  // Pattern from the official @supabase/ssr middleware guide: we hold a
  // `cookieResponse` that the Supabase cookie adapter writes refreshed cookies
  // onto, then we copy those cookies onto whatever response we actually return.
  let cookieResponse = NextResponse.next({ request });
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          cookieResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            cookieResponse.cookies.set(name, value, options as CookieOptions);
          }
        },
      },
    });
    // Touch the session — this triggers a refresh + cookie update if needed.
    await supabase.auth.getUser();
  }

  // ── Host-based tenant rewrite ────────────────────────────────────────
  const hostname = request.headers.get('host') || '';
  const isLocalhost = hostname.includes('localhost') || hostname.includes('127.0.0.1');
  const isVercelHost = hostname.endsWith('.vercel.app');

  const path = url.pathname;
  const isGymPath =
    path === '/login' ||
    path.startsWith('/login/') ||
    path === '/join' ||
    path.startsWith('/join/') ||
    path === '/dashboard' ||
    path.startsWith('/dashboard/') ||
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/coach' ||
    path.startsWith('/coach/') ||
    path === '/checkin' ||
    path.startsWith('/checkin/') ||
    path === '/classes' ||
    path.startsWith('/classes/');

  let rewriteUrl: URL | null = null;

  if (isLocalhost || isVercelHost || hostname === 'gymflow.ng' || hostname === 'www.gymflow.ng') {
    // Apex / preview: platform routes render directly. Bare gym-scoped paths
    // fall back to the demo gym on localhost/preview.
    if (isGymPath) {
      const localSlug = process.env.LOCAL_DEFAULT_GYM_SLUG || 'gf-test-gym';
      rewriteUrl = buildRewrite(url, isLocalhost || isVercelHost ? localSlug : '');
    }
  } else {
    // Real tenant subdomain
    const slug = hostname.split('.')[0];
    if (SLUG_RE.test(slug)) {
      rewriteUrl = buildRewrite(url, slug);
    }
  }

  if (!rewriteUrl) return cookieResponse;

  // Apply the rewrite while preserving the refreshed Supabase auth cookies.
  const rewriteRes = NextResponse.rewrite(rewriteUrl, { request });
  for (const cookie of cookieResponse.cookies.getAll()) {
    rewriteRes.cookies.set(cookie);
  }
  return rewriteRes;
}

function buildRewrite(url: URL, slug: string): URL {
  const out = new URL(url.toString());
  const path = url.pathname;
  if (path.startsWith('/admin')) {
    out.pathname = `/gym/${slug}/admin${path.replace('/admin', '') || '/'}`;
  } else if (path.startsWith('/coach')) {
    out.pathname = `/gym/${slug}/coach${path.replace('/coach', '') || '/'}`;
  } else if (path.startsWith('/join')) {
    out.pathname = `/gym/${slug}/join${path.replace('/join', '') || '/'}`;
  } else if (path.startsWith('/login')) {
    out.pathname = `/gym/${slug}/login${path.replace('/login', '') || '/'}`;
  } else if (path.startsWith('/dashboard')) {
    out.pathname = `/gym/${slug}/dashboard${path.replace('/dashboard', '') || '/'}`;
  } else {
    out.pathname = `/gym/${slug}${path}`;
  }
  return out;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};

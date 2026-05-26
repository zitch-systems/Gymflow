import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
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

  const isLocalhost = hostname.includes('localhost') || hostname.includes('127.0.0.1');

  // Vercel preview/production domains have no tenant subdomain, so treat them
  // like the platform apex: platform routes render directly, bare gym-scoped
  // paths fall back to the default demo gym, and explicit /gym/{slug}/* paths
  // pass through untouched. Without this the whole *.vercel.app host name would
  // be misread as a tenant slug.
  const isVercelHost = hostname.endsWith('.vercel.app');

  // Platform domain (no subdomain) — render platform routes without rewriting.
  // Same for localhost: only gym-scoped paths get rewritten to demo-gym.
  if (
    isLocalhost ||
    isVercelHost ||
    hostname === 'gymflow.ng' ||
    hostname === 'www.gymflow.ng'
  ) {
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
    if (!isGymPath) return NextResponse.next();
    const localSlug = process.env.LOCAL_DEFAULT_GYM_SLUG || 'gf-test-gym';
    return rewriteToGym(url, isLocalhost || isVercelHost ? localSlug : '');
  }

  // Extract gym slug from subdomain (e.g., powerhouse.gymflow.ng)
  const slug = hostname.split('.')[0];
  return rewriteToGym(url, slug);
}

function rewriteToGym(url: URL, slug: string) {
  const path = url.pathname;

  if (path.startsWith('/admin')) {
    url.pathname = `/gym/${slug}/admin${path.replace('/admin', '') || '/'}`;
  } else if (path.startsWith('/coach')) {
    url.pathname = `/gym/${slug}/coach${path.replace('/coach', '') || '/'}`;
  } else if (path.startsWith('/join')) {
    url.pathname = `/gym/${slug}/join${path.replace('/join', '') || '/'}`;
  } else if (path.startsWith('/login')) {
    url.pathname = `/gym/${slug}/login${path.replace('/login', '') || '/'}`;
  } else if (path.startsWith('/dashboard')) {
    url.pathname = `/gym/${slug}/dashboard${path.replace('/dashboard', '') || '/'}`;
  } else {
    url.pathname = `/gym/${slug}${path}`;
  }

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};

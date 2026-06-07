import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Supabase auth callback. The password-reset (and any future magic-link) email
// links point here with a PKCE `code`. Exchanging it must happen in a Route
// Handler — that's where the @supabase/ssr cookie adapter can actually WRITE the
// session cookies (Server Components are read-only). After the exchange we bounce
// to `next` (e.g. /reset-password), now with a live recovery session.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/';
  // Only allow same-origin relative paths — never an attacker-controlled absolute URL.
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth', request.url));
}

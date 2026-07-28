import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Supabase password-reset (and email-confirmation) callback.
// The reset email links here with either:
//   ?code=<pkce_code>              (PKCE — @supabase/ssr default)
//   ?token_hash=<hash>&type=<type> (OTP / magic-link fallback)
// We exchange the credential for a server-side session, then hand off to `next`.
// `next` is validated to be a relative path so this cannot be used as an open
// redirect to external URLs.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  // Narrow `type` against an allowlist rather than casting it: it is forwarded
  // straight to verifyOtp, so an unchecked value lets a crafted link drive that
  // call with an arbitrary string. Anything unrecognised is dropped to null,
  // which falls through to the link-expired branch.
  const rawType = searchParams.get('type');
  const VERIFIABLE = ['recovery', 'signup', 'magiclink', 'email', 'email_change', 'invite'] as const;
  const type = (VERIFIABLE as readonly string[]).includes(rawType ?? '')
    ? (rawType as (typeof VERIFIABLE)[number])
    : null;
  const rawNext = searchParams.get('next') ?? '/';

  // Only allow relative paths — reject anything that looks like an absolute URL
  // or a protocol-relative URL to prevent open redirect abuse.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Exchange failed — redirect to login with an error hint so the user can
  // request a new link rather than seeing a blank error page.
  return NextResponse.redirect(`${origin}/login?error=link_expired`);
}

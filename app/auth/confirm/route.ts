import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { confirmationHandoff } from '@/lib/auth/confirmation';

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

  // Only allow a same-origin path. Also unwrap the callback-inside-callback
  // shape from emails sent before the redirect fix, so an already-issued member
  // link can still finish at /launch after this deployment.
  const next = confirmationHandoff(rawNext, '/');

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

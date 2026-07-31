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
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// The types Supabase's verifyOtp accepts.
type OtpType = 'recovery' | 'signup' | 'magiclink' | 'email' | 'email_change' | 'invite';

// Map the URL's type param to a verifyOtp type. The email hook puts the full
// AuthActionType (e.g. email_change_new) into the URL, but verifyOtp expects
// the base 'email_change' for both the current- and new-address confirmations.
function resolveOtpType(raw: string | null): OtpType | null {
  const DIRECT: readonly string[] = ['recovery', 'signup', 'magiclink', 'email', 'email_change', 'invite'];
  if (DIRECT.includes(raw ?? '')) return raw as OtpType;
  if (raw === 'email_change_current' || raw === 'email_change_new') return 'email_change';
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = resolveOtpType(searchParams.get('type'));
  const rawNext = searchParams.get('next') ?? '/';

  // Only allow a same-origin path. Also unwrap the callback-inside-callback
  // shape from emails sent before the redirect fix, so an already-issued member
  // link can still finish at /launch after this deployment.
  const next = confirmationHandoff(rawNext, '/');

  try {
    const supabase = await createClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    }
  } catch {
    // Network error or Supabase unreachable — fall through to the error redirect
    // so the member sees a recoverable message instead of an infinite spinner.
  }

  // Exchange failed — redirect to login with an error hint so the user can
  // request a new link rather than seeing a blank error page.
  return NextResponse.redirect(`${origin}/login?error=link_expired`);
}

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { provisionOwner } from '@/lib/provision';
import { validatePassword } from '@/lib/auth/password';
import { clientIp, rateLimit } from '@/lib/rate-limit';

// `code` lets the client react to specific failures (e.g. offer a resend
// button when the email is unconfirmed) without string-matching messages.
export type AuthState = { error: string | null; code?: 'unconfirmed' };

function friendlySignInError(message: string): AuthState {
  if (/email not confirmed/i.test(message)) {
    return { error: 'Your email isn’t confirmed yet. Check your inbox (and spam) for the confirmation link, or resend it below.', code: 'unconfirmed' };
  }
  if (/invalid login credentials/i.test(message)) {
    return { error: 'Wrong email or password. Try again, or use “Forgot password?”.' };
  }
  return { error: message };
}

// Sign in with email + password, then route by role (member/staff/platform).
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  // Throttle the credential-guessing surface — per target email (defends one
  // account) and per caller IP (defends the whole endpoint), mirroring signUp
  // and requestPasswordReset. Fail-open if the limiter is unavailable.
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`login:ip:${ip}`, 30, 900),
    rateLimit(`login:email:${email.toLowerCase()}`, 10, 900),
  ]);
  if (!ipOk || !emailOk) return { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return friendlySignInError(error.message);

  // Route by role on the NEXT request (/launch) — not here. Inside this action
  // the just-created session isn't attached to data queries yet, so role
  // lookups run as the anon role and return nothing. /launch re-runs the lookup
  // on a fresh request where the auth cookie applies. See app/launch/page.tsx.
  redirect('/launch');
}

// Create a gym workspace + owner account, in ONE step. There is no DB signup
// trigger — this action does the whole job:
//   1. auth.signUp (gym name kept in user_metadata as a recovery breadcrumb)
//   2. service-role: confirm the email (Supabase's built-in confirmation mail
//      is rate-limited to a handful per hour without custom SMTP, which
//      stranded every new account behind "Email not confirmed")
//   3. sign in → session cookies
//   4. provision gym + profile + owner staff link (lib/provision.ts)
//   5. → /launch → /admin
// If the service-role key is absent (preview envs), it degrades to the
// confirm-by-email path, and /launch self-heals provisioning on first entry.
export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const gymName = String(formData.get('gym') ?? '').trim();
  if (!gymName) return { error: 'Enter your gym’s name.' };
  if (!email || !password) return { error: 'Enter your email and password.' };
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };

  // Signup auto-confirms via the service role (below), which bypasses
  // Supabase's own email rate limit — so this action is the platform's most
  // abusable endpoint and gets its own throttle. Must run BEFORE
  // supabase.auth.signUp so a blocked attempt leaves no half-created user.
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`signup:ip:${ip}`, 5, 3600),
    rateLimit(`signup:email:${email.toLowerCase()}`, 3, 3600),
  ]);
  if (!ipOk || !emailOk) return { error: 'Too many sign-up attempts. Please wait an hour and try again.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/login?confirmed=1`,
      data: { gym_name: gymName },
    },
  });
  if (error) return { error: error.message };

  // With confirmations enabled Supabase obfuscates "email already registered"
  // by returning a user with no identities. Surface it honestly instead of
  // letting the person wait for an email that will never come.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { error: 'An account with this email already exists. Sign in instead (or reset your password).' };
  }
  if (!data.user) return { error: 'Could not create the account. Please try again.' };

  let session = data.session; // non-null when confirmations are disabled

  // Auto-confirm + sign in so signup is one step and never depends on email
  // delivery. Password reset still proves mailbox ownership later if needed.
  if (!session) {
    try {
      const admin = createAdminClient();
      const { error: confirmErr } = await admin.auth.admin.updateUserById(data.user.id, { email_confirm: true });
      if (!confirmErr) {
        const { data: signed, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!signErr) session = signed.session;
      }
    } catch {
      // No service-role key in this environment — fall through to email flow.
    }
  }

  const prov = await provisionOwner({ userId: data.user.id, email, gymName });
  if (!prov.ok) console.error(`[signup] provisioning failed for ${data.user.id}: ${prov.error}`); // /launch self-heals

  if (session) redirect('/launch');
  redirect('/login?check-email=1');
}

// Resend the signup confirmation email (for accounts created before
// auto-confirm, or when the service-role key isn't configured).
export async function resendConfirmation(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email above first, then resend.' };
  // Each call sends a real (now branded) confirmation email to an arbitrary
  // address with no auth — throttle per target inbox and per caller IP so it
  // can't be turned into a free mail cannon that torches the sending domain's
  // reputation. Fail-open, like the other auth limiters.
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`resend:ip:${ip}`, 5, 3600),
    rateLimit(`resend:email:${email.toLowerCase()}`, 3, 3600),
  ]);
  if (!ipOk || !emailOk) return { error: 'Too many requests. Please wait a while and try again.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/login?confirmed=1` },
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

// Step-up re-authentication: confirms the signed-in user still knows their
// password before a sensitive, hard-to-reverse action proceeds (e.g.
// redirecting payouts to a different bank account). Re-submitting sign-in
// with the same email just refreshes the existing session on success; on a
// wrong password it errors without touching the current session.
export async function verifyPassword(password: string): Promise<AuthState> {
  if (!password) return { error: 'Enter your password to confirm.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: 'Not signed in.' };
  // Throttle per account (defends against a stolen-session attacker
  // brute-forcing the password) and per IP (defends the check itself).
  const ip = await clientIp();
  const [userOk, ipOk] = await Promise.all([
    rateLimit(`reauth:user:${user.id}`, 8, 600),
    rateLimit(`reauth:ip:${ip}`, 30, 600),
  ]);
  if (!userOk || !ipOk) return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (error) return { error: 'Wrong password.' };
  return { error: null };
}

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email.' };
  // Each call sends a real email — throttle per target address (defends the
  // victim's inbox) and per caller IP (defends the send quota).
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`pwreset:ip:${ip}`, 8, 3600),
    rateLimit(`pwreset:email:${email.toLowerCase()}`, 3, 3600),
  ]);
  if (!ipOk || !emailOk) return { error: 'Too many reset requests. Please wait an hour and try again.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/auth/confirm?next=/reset-password`,
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get('password') ?? '');
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect('/login?reset=1');
}

// Finish setup for an authenticated account with no role anywhere — i.e. a
// signup from before provisioning existed, or one whose provisioning failed.
// Rendered by /launch as a one-field "name your gym" form.
export async function completeSetup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const gymName = String(formData.get('gym') ?? '').trim();
  if (!gymName) return { error: 'Enter your gym’s name.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const prov = await provisionOwner({ userId: user.id, email: user.email ?? '', gymName });
  if (!prov.ok) return { error: prov.error ?? 'Could not finish setup. Please try again.' };
  redirect('/launch');
}

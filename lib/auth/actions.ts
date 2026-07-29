'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { provisionOwner } from '@/lib/provision';
import { createApiAuthClient } from '@/lib/gym-signup';
import { validatePassword } from '@/lib/auth/password';
import {
  clearPendingChallenge, establishSession, hasTrustedDevice, issueChallenge, readPendingChallenge,
  rememberDevice, twoFactorRequiredForUser, twoFactorTargetByEmail, verifyPendingCode,
} from '@/lib/auth/two-factor';
import { isWellFormedCode } from '@/lib/two-factor';
import { clientIp, rateLimit } from '@/lib/rate-limit';

// `code` lets the client react to specific failures (e.g. offer a resend
// button when the email is unconfirmed) without string-matching messages.
export type AuthState = { error: string | null; code?: 'unconfirmed' };

// Two-factor verification state for /verify. `sent` drives the "a new code is
// on its way" line without overloading `error` with success messages.
export type TwoFactorState = { error: string | null; sent?: boolean };

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

  // Does this account need a second factor? Asked BEFORE the password is
  // checked so the common (no-2FA) path keeps its single sign-in round-trip.
  // The answer never reaches the caller: both branches return the same errors
  // for a wrong password, so this can't be used to enumerate staff accounts.
  const target = await twoFactorTargetByEmail(email);

  if (target?.required && !(await hasTrustedDevice(target.userId))) {
    // Verify the password WITHOUT establishing cookies. A session created
    // before the second factor is a session an attacker holding the password
    // could lift straight out of their own browser and use against PostgREST,
    // where no app-layer check applies — the challenge would be theatre.
    const headless = createApiAuthClient();
    const { error } = await headless.auth.signInWithPassword({ email, password });
    if (error) return friendlySignInError(error.message);
    await headless.auth.signOut();

    const issued = await issueChallenge({ userId: target.userId, email: target.email });
    if (!issued.ok) return { error: issued.error ?? 'Could not send your sign-in code.' };
    redirect('/verify');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return friendlySignInError(error.message);

  // Safety net: the pre-check resolves the account by profiles.email, so an
  // account whose profile row is missing or holds a different address would
  // slip past it. Now that the user id is known for certain, ask again — and
  // if the answer is yes, drop the session we just created and challenge.
  const { data: { user } } = await supabase.auth.getUser();
  if (user && !target?.required && await twoFactorRequiredForUser(user.id)) {
    if (!(await hasTrustedDevice(user.id))) {
      await supabase.auth.signOut();
      const issued = await issueChallenge({ userId: user.id, email: user.email ?? email });
      if (!issued.ok) return { error: issued.error ?? 'Could not send your sign-in code.' };
      redirect('/verify');
    }
  }

  // Route by role on the NEXT request (/launch) — not here. Inside this action
  // the just-created session isn't attached to data queries yet, so role
  // lookups run as the anon role and return nothing. /launch re-runs the lookup
  // on a fresh request where the auth cookie applies. See app/launch/page.tsx.
  redirect('/launch');
}

/**
 * Second step of a staff sign-in: check the emailed code, then mint the session.
 *
 * The password was already verified (headlessly) by signIn — this action is
 * reachable only with the httpOnly challenge cookie that step set, and the
 * challenge is single-use.
 */
export async function verifyTwoFactor(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const code = String(formData.get('code') ?? '');
  const trust = formData.get('trust') === 'on';
  if (!isWellFormedCode(code)) return { error: 'Enter the 6-digit code from your email.' };

  // Throttle the submit endpoint itself, on top of the per-challenge attempt
  // cap: without it, an attacker holding a challenge cookie could cycle
  // challenges to keep guessing.
  const ip = await clientIp();
  if (!(await rateLimit(`2fa-verify:ip:${ip}`, 30, 900))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }

  const result = await verifyPendingCode(code);
  if (!result.ok) return { error: result.error };

  const session = await establishSession(result.email);
  if (!session.ok) return { error: session.error ?? 'Could not complete sign-in.' };

  if (trust) await rememberDevice(result.userId);
  redirect('/launch');
}

/** Send a fresh code for the pending challenge (the old one stays dead).
 *  Takes neither the previous state nor the form: the challenge it re-sends is
 *  identified by the httpOnly cookie, never by anything the client posts. */
export async function resendTwoFactor(): Promise<TwoFactorState> {
  const pending = await readPendingChallenge();
  if (!pending) return { error: 'Your verification session expired. Sign in again.' };
  const issued = await issueChallenge({ userId: pending.userId, email: pending.email });
  if (!issued.ok) return { error: issued.error ?? 'Could not send a new code.' };
  return { error: null, sent: true };
}

// Create a gym workspace + owner account. Two steps, by design:
//   1. auth.signUp (gym name kept in user_metadata as the provisioning
//      breadcrumb) → Supabase sends a confirmation link, rendered by our own
//      branded template via the Send Email hook
//   2. the owner clicks it → /auth/confirm exchanges it for a session →
//      /launch provisions gym + profile + owner staff link and lands on /admin
//
// This used to auto-confirm the address with the service role and sign the
// owner straight in, because Supabase's built-in mail is rate-limited without
// custom SMTP and stranded every new account. That constraint is gone now that
// auth mail goes out through Resend — and self-confirming meant GymFlow never
// actually proved the owner controlled the mailbox that receives their payout
// alerts, password resets and (now) their two-factor codes. So: no gym exists
// until the address is verified, which also keeps unverified junk signups out
// of the gyms table entirely.
export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirm_password') ?? '');
  const gymName = String(formData.get('gym') ?? '').trim();
  if (!gymName) return { error: 'Enter your gym’s name.' };
  if (!email || !password) return { error: 'Enter your email and password.' };
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };
  // Checked server-side as well as in the browser: the client comparison is a
  // convenience, and an action that trusts it would accept a typo'd password
  // from any form post that skips the UI.
  if (password !== confirmPassword) return { error: 'The two passwords don’t match.' };

  // Signup is a public endpoint that creates auth users and sends mail, so it
  // gets its own throttle. Must run BEFORE supabase.auth.signUp so a blocked
  // attempt leaves no half-created user.
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
      // Through /auth/confirm rather than straight to /login: it exchanges the
      // link for a session, so the owner lands on /launch already signed in
      // and their gym is provisioned on the spot instead of asking them to
      // type the password they just chose all over again.
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/auth/confirm?next=/launch`,
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

  // No gym is provisioned here. If the project has confirmations turned off,
  // signUp hands back a session immediately and /launch does the provisioning
  // from user_metadata.gym_name on the next request — the same self-heal path
  // that has always covered a failed provision. Otherwise the owner gets a
  // confirmation email and nothing exists in the gyms table until they prove
  // they can read it.
  if (data.session) redirect('/launch');
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
  // Drop any half-finished two-factor challenge too, so signing out mid-verify
  // doesn't leave a live challenge cookie for the next person at this browser.
  await clearPendingChallenge();
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

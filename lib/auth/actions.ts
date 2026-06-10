'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { provisionOwner } from '@/lib/provision';

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
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };

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

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/reset-password`,
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get('password') ?? '');
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
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

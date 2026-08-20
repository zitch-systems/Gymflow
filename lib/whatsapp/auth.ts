import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createApiAuthClient, provisionMember } from '@/lib/gym-signup';
import { sendGymEmail } from '@/lib/email/send';
import { whatsappSignupCode } from '@/lib/email/templates/whatsapp';
import { codeMatches, hashCode, numericCode } from '@/lib/crypto/secret-box';
import { gymByMemberCode, type WhatsAppGym } from '@/lib/whatsapp/settings';
import { activeGymIds } from '@/lib/whatsapp/contacts';
import { waIdToLocal } from '@/lib/whatsapp/phone';
import { rateLimit } from '@/lib/rate-limit';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// The bridge between a WhatsApp Flow submission and a GymFlow account.
//
// THE ONE IMPORTANT PROPERTY: a WhatsApp sign-up produces an ORDINARY Supabase
// auth user with an ordinary password hash. There is no WhatsApp-specific
// credential anywhere. That is what makes "the same password works in the
// mobile app" true by construction rather than by a synchronisation job that
// could drift — /api/app/signin calls signInWithPassword against the same user
// record this file creates.
//
// EMAIL VERIFICATION IS REAL HERE. The account is created with
// email_confirm: false and only flipped to confirmed once the six-digit code
// comes back. That is deliberately stricter than /api/app/signup, which
// auto-confirms so signup never depends on mail delivery; here the member is
// mid-conversation and can be walked through it, so there is no reason to skip
// proving they own the address.

const OTP_TTL_MIN = 15;
const OTP_MAX_ATTEMPTS = 5;
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type AuthOutcome =
  | { ok: true; userId: string; gym: WhatsAppGym; needsVerification: boolean; fullName: string | null }
  | { ok: false; error: string };

/**
 * Step 1 of sign-up: validate, create the (unconfirmed) auth user, email a code.
 *
 * Nothing is written to gym_member_links yet. An account that never confirms
 * its email must not appear in a gym's member list, and reversing that later is
 * far messier than simply not doing it until the code comes back.
 */
export async function beginSignup(params: {
  gymCode: string;
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  waId: string;
}): Promise<AuthOutcome> {
  const email = params.email.trim().toLowerCase();
  const fullName = params.fullName.trim();

  if (!EMAIL_RE.test(email)) return { ok: false, error: 'That email address doesn’t look right. Please check it.' };
  if (!fullName) return { ok: false, error: 'Please enter your full name.' };
  if (params.password.length < MIN_PASSWORD) {
    return { ok: false, error: `Your password needs at least ${MIN_PASSWORD} characters.` };
  }
  // The whole reason the Flow asks twice. Compared here rather than in the Flow
  // JSON because client-side validation is a convenience, not a guarantee.
  if (params.password !== params.confirmPassword) {
    return { ok: false, error: 'The two passwords don’t match. Please type them again.' };
  }

  // Per-number and per-address throttles. Account creation sends mail and is
  // the one path here that a stranger can reach without any credential.
  const [numberOk, emailOk] = await Promise.all([
    rateLimit(`wa-signup:wa:${params.waId}`, 5, 3600),
    rateLimit(`wa-signup:email:${email}`, 5, 3600),
  ]);
  if (!numberOk || !emailOk) {
    return { ok: false, error: 'Too many attempts. Please wait an hour and try again.' };
  }

  const admin = createAdminClient();
  const gym = await gymByMemberCode(admin, params.gymCode);
  if (!gym) return { ok: false, error: 'We couldn’t find a gym with that code. Please check it with your gym.' };

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: params.password,
    // Held back until the code is verified — this is the verification.
    email_confirm: false,
    user_metadata: { full_name: fullName, signup_source: 'whatsapp' },
  });

  if (error) {
    // Supabase reports an existing address as a 422. Say so plainly: pretending
    // otherwise would leave them stuck retyping a password that can never work.
    const msg = error.message.toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return { ok: false, error: 'That email already has a GymFlow account. Go back and choose “Sign in” instead.' };
    }
    if (msg.includes('password')) return { ok: false, error: 'That password was rejected. Try a longer one.' };
    return { ok: false, error: 'We couldn’t create your account just now. Please try again shortly.' };
  }
  if (!created.user) return { ok: false, error: 'We couldn’t create your account just now. Please try again shortly.' };

  const sent = await issueEmailOtp(admin, {
    email,
    userId: created.user.id,
    gym,
    waId: params.waId,
    fullName,
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  return { ok: true, userId: created.user.id, gym, needsVerification: true, fullName };
}

/**
 * Mint a fresh six-digit code, store only its hash, and email it.
 *
 * Any earlier unconsumed code for this address is retired first, so a member
 * who taps "send a new code" is never left with two codes where the older one
 * still works.
 */
export async function issueEmailOtp(
  admin: Admin,
  params: { email: string; userId: string | null; gym: WhatsAppGym; waId: string; fullName?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await admin
    .from('whatsapp_email_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('email', params.email)
    .eq('purpose', 'signup')
    .is('consumed_at', null);

  const code = numericCode(6);
  const { error } = await admin.from('whatsapp_email_otps').insert({
    email: params.email,
    code_hash: hashCode(code),
    purpose: 'signup',
    user_id: params.userId,
    gym_id: params.gym.id,
    wa_id: params.waId,
    expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
  });
  if (error) return { ok: false, error: 'We couldn’t start email verification. Please try again.' };

  const res = await sendGymEmail({
    gym: { id: params.gym.id, name: params.gym.name, slug: params.gym.slug },
    to: { email: params.email, fullName: params.fullName ?? null },
    // 'critical' so it bypasses the gym's marketing toggles: this is not a
    // nudge, it is the only way the member can finish signing up.
    category: 'critical',
    template: 'whatsapp_signup_code',
    ...whatsappSignupCode({
      code,
      minutes: OTP_TTL_MIN,
      gymName: params.gym.name,
      fullName: params.fullName,
      email: params.email,
    }),
  });

  // Skipped means Resend isn't configured or the address is suppressed. Either
  // way the member will never receive a code, so say so rather than parking
  // them on a screen waiting for mail that isn't coming.
  if (!res.ok) {
    return {
      ok: false,
      error: 'We couldn’t send the confirmation email. Please check the address, or ask your gym to add you.',
    };
  }
  return { ok: true };
}

/**
 * Step 2 of sign-up: check the code, confirm the address, join the gym.
 *
 * The attempt counter is incremented before the comparison so a failed guess
 * always costs one, including on a crash between the two.
 */
export async function verifyEmailOtp(params: {
  email: string;
  code: string;
  waId: string;
}): Promise<AuthOutcome> {
  const email = params.email.trim().toLowerCase();
  const code = params.code.replace(/\D/g, '');
  if (code.length !== 6) return { ok: false, error: 'Enter the 6-digit code from your email.' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('whatsapp_email_otps')
    .select('id, code_hash, user_id, gym_id, attempts, expires_at')
    .eq('email', email)
    .eq('purpose', 'signup')
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const otp = data as {
    id: string; code_hash: string; user_id: string | null; gym_id: string | null;
    attempts: number; expires_at: string;
  } | null;

  if (!otp) return { ok: false, error: 'That code has expired. Tap “Send a new code”.' };
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'That code has expired. Tap “Send a new code”.' };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    // Burn it rather than leaving a code that can be ground down over time.
    await admin.from('whatsapp_email_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id);
    return { ok: false, error: 'Too many wrong codes. Tap “Send a new code” to start again.' };
  }

  await admin.from('whatsapp_email_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);

  if (!codeMatches(code, otp.code_hash)) {
    const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
    return {
      ok: false,
      error: left > 0 ? `That code isn’t right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'That code isn’t right.',
    };
  }

  await admin.from('whatsapp_email_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id);

  if (!otp.user_id || !otp.gym_id) return { ok: false, error: 'Something went wrong. Please start again.' };

  const { data: gymRow } = await admin
    .from('gyms').select('id, name, slug, member_code, status, phone, subscription_plan, paystack_subaccount_code, platform_commission_mode, platform_commission_fixed_amount')
    .eq('id', otp.gym_id).maybeSingle();
  const gym = gymRow as WhatsAppGym | null;
  if (!gym) return { ok: false, error: 'That gym is no longer available. Please contact your gym.' };

  // The address is proven. Confirm it, which is what lets the member sign in on
  // the app and the web with the password they just chose.
  const { error: confirmErr } = await admin.auth.admin.updateUserById(otp.user_id, { email_confirm: true });
  if (confirmErr) return { ok: false, error: 'We couldn’t confirm your email. Please try again.' };

  const { data: userRes } = await admin.auth.admin.getUserById(otp.user_id);
  const fullName = (userRes?.user?.user_metadata?.full_name as string | undefined) ?? null;

  const prov = await provisionMember({
    userId: otp.user_id,
    email,
    gymId: gym.id,
    fullName,
    // Their WhatsApp number becomes their profile phone, which is what lets us
    // recognise them on future messages without asking them to sign in again.
    phone: waIdToLocal(params.waId),
    onboardingMethod: 'whatsapp',
  });
  if (!prov.ok) return { ok: false, error: 'Your email is confirmed, but joining the gym failed. Please contact the front desk.' };

  return { ok: true, userId: otp.user_id, gym, needsVerification: false, fullName };
}

/**
 * Sign in with an existing GymFlow password.
 *
 * We authenticate to prove identity and then immediately discard the session:
 * WhatsApp has no browser and nothing here needs a JWT. What we keep is the
 * link between this WhatsApp number and that user id, which every later request
 * in the conversation is authorised against.
 */
export async function signinWithPassword(params: {
  email: string;
  password: string;
  waId: string;
  gymCode?: string | null;
}): Promise<AuthOutcome> {
  const email = params.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || !params.password) {
    return { ok: false, error: 'Enter your email and password.' };
  }

  const [numberOk, emailOk] = await Promise.all([
    rateLimit(`wa-signin:wa:${params.waId}`, 10, 900),
    rateLimit(`wa-signin:email:${email}`, 10, 900),
  ]);
  if (!numberOk || !emailOk) {
    return { ok: false, error: 'Too many sign-in attempts. Please wait a few minutes and try again.' };
  }

  const auth = createApiAuthClient();
  const { data, error } = await auth.auth.signInWithPassword({ email, password: params.password });
  if (error || !data.user) {
    // Supabase returns the same "invalid credentials" for an unconfirmed
    // address, so check that case explicitly and give the honest reason.
    if (error?.message?.toLowerCase().includes('not confirmed')) {
      return { ok: false, error: 'Please confirm your email first — check your inbox for the code we sent.' };
    }
    return { ok: false, error: 'Wrong email or password.' };
  }
  // Nothing in WhatsApp uses the session; holding one open would be a token
  // sitting around with no owner.
  await auth.auth.signOut({ scope: 'local' });

  const admin = createAdminClient();
  const userId = data.user.id;

  // Which gym? An explicit code wins. Otherwise, if they belong to exactly one
  // gym, use it; more than one and the conversation asks.
  let gym: WhatsAppGym | null = null;
  if (params.gymCode) {
    gym = await gymByMemberCode(admin, params.gymCode);
    if (!gym) return { ok: false, error: 'We couldn’t find a gym with that code.' };
  } else {
    const gymIds = await activeGymIds(admin, userId);
    if (gymIds.length === 0) {
      return { ok: false, error: 'You’re signed in, but you’re not a member of any gym yet. Ask your gym for their code.' };
    }
    const { data: gymRow } = await admin
      .from('gyms').select('id, name, slug, member_code, status, phone, subscription_plan, paystack_subaccount_code, platform_commission_mode, platform_commission_fixed_amount')
      .eq('id', gymIds[0]).maybeSingle();
    gym = gymRow as WhatsAppGym | null;
  }
  if (!gym) return { ok: false, error: 'We couldn’t load your gym. Please try again.' };

  // Signing in through WhatsApp joins the gym if they aren't linked yet — the
  // same idempotent trust model /api/app/signin already uses for the app.
  const prov = await provisionMember({
    userId,
    email,
    gymId: gym.id,
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
    phone: waIdToLocal(params.waId),
    onboardingMethod: 'whatsapp',
  });
  if (!prov.ok) return { ok: false, error: 'Signed in, but we couldn’t attach your gym. Please try again.' };

  // Store the WhatsApp number on the profile if it has none, so the next
  // message is recognised without another sign-in.
  const local = waIdToLocal(params.waId);
  if (local) {
    const { data: profile } = await admin.from('profiles').select('phone').eq('id', userId).maybeSingle();
    if (profile && !(profile as { phone: string | null }).phone) {
      await admin.from('profiles').update({ phone: local }).eq('id', userId);
    }
  }

  return {
    ok: true,
    userId,
    gym,
    needsVerification: false,
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
  };
}

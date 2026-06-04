'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleHome } from './dal';
import { sendWelcome } from '@/lib/email';
import { waWelcome } from '@/lib/whatsapp';
import { rateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

export type SignInState =
  | { error: string }
  | undefined;

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectTo = String(formData.get('redirect') ?? '');

  if (!email || !password) {
    return { error: 'Please fill in all fields.' };
  }

  // Throttle credential stuffing: keyed on IP + email so neither dimension
  // alone can mask a brute-force attempt.
  const ip = await clientIpFromHeaders();
  const rlIp = rateLimit({ key: `signin-ip:${ip}`, limit: 10, windowMs: 60_000 });
  const rlEmail = rateLimit({ key: `signin-email:${email.toLowerCase()}`, limit: 5, windowMs: 60_000 });
  if (!rlIp.ok || !rlEmail.ok) {
    return { error: 'Too many sign-in attempts. Please wait a minute and try again.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid login credentials') || msg.includes('invalid')) {
      return { error: 'Invalid email or password. Please try again.' };
    }
    if (msg.includes('email not confirmed')) {
      return { error: 'Please check your email and click the confirmation link before signing in.' };
    }
    if (msg.includes('429') || msg.includes('rate')) {
      return { error: 'Too many login attempts. Please wait a minute and try again.' };
    }
    return { error: error.message };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  const target = redirectTo || roleHome(profile?.role);
  redirect(target);
}

export type SignUpState =
  | { error: string }
  | undefined;

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const ip = await clientIpFromHeaders();
  const rl = rateLimit({ key: `signup:${ip}`, limit: 5, windowMs: 60_000 });
  if (!rl.ok) return { error: 'Too many signups from this network. Please wait a minute.' };

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const fullName = String(formData.get('full_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const gymSlug = String(formData.get('gym') ?? '').trim();

  const dateOfBirth = String(formData.get('date_of_birth') ?? '').trim() || null;
  const gender = String(formData.get('gender') ?? '').trim() || null;
  const address = String(formData.get('address') ?? '').trim() || null;
  const nokName = String(formData.get('nok_name') ?? '').trim();
  const nokRelationship = String(formData.get('nok_relationship') ?? '').trim();
  const nokPhone = String(formData.get('nok_phone') ?? '').trim();
  const nokAddress = String(formData.get('nok_address') ?? '').trim() || null;
  const healthNotes = String(formData.get('health_notes') ?? '').trim() || null;
  const waiverSigned = formData.get('waiver_signed') === 'on';

  if (!email || !password || !fullName || !phone) {
    return { error: 'Please complete all required fields.' };
  }
  if (!nokName || !nokRelationship || !nokPhone) {
    return { error: 'Emergency contact (name, relationship, phone) is required.' };
  }
  if (!waiverSigned) {
    return { error: 'You must agree to the terms before joining.' };
  }
  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' };
  }

  // Everything flows through raw_user_meta_data; the database
  // `handle_new_user` trigger (SECURITY DEFINER) populates profiles,
  // waiver_signatures and gym_member_links in one transaction so we
  // don't have to worry about RLS / cookie-propagation between the
  // signUp call and follow-up writes.
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone,
        date_of_birth: dateOfBirth,
        gender,
        address,
        nok_name: nokName,
        nok_relationship: nokRelationship,
        nok_phone: nokPhone,
        nok_address: nokAddress,
        health_notes: healthNotes,
        waiver_signed: waiverSigned,
        signup_gym_slug: gymSlug || null,
      },
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('signups not allowed') || msg.includes('email signups are disabled')) {
      return { error: 'Sign-ups are currently disabled. Please contact the gym admin to be added.' };
    }
    if (msg.includes('already registered')) {
      return { error: 'This email is already registered. Please sign in instead.' };
    }
    return { error: error.message };
  }

  // Welcome notifications run AFTER the response is sent. Email/WhatsApp
  // providers can be slow (or cold), and previously this block was awaited
  // before the redirect — a slow Resend call could push the whole signup
  // request past the serverless function timeout (504). Deferring with
  // after() lets the redirect fire immediately; the sends finish in the
  // background. Mirrors the receipt-send pattern in lib/paystack-fulfill.ts.
  after(async () => {
    try {
      const dashboardUrl = gymSlug
        ? `https://${gymSlug}.gymflow.ng/dashboard`
        : `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/dashboard`;
      const gymName = gymSlug ? gymSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'GymFlow';
      await Promise.allSettled([
        sendWelcome(email, fullName, gymName, dashboardUrl),
        phone ? waWelcome(phone, fullName, gymName, dashboardUrl) : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF signUp] welcome notifications failed:', (e as Error).message);
    }
  });

  redirect(`/login?welcome=1${gymSlug ? `&gym=${encodeURIComponent(gymSlug)}` : ''}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function requestPasswordReset(email: string, originUrl: string): Promise<{ error: string | null }> {
  const ip = await clientIpFromHeaders();
  const rl = rateLimit({ key: `pwreset:${ip}`, limit: 5, windowMs: 60_000 });
  if (!rl.ok) return { error: 'Too many reset attempts. Please wait a minute.' };

  if (!email) return { error: 'Enter your email first' };

  // Validate redirectTo against an allowlist — Supabase's redirectTo is the
  // post-reset landing URL, and accepting any client-supplied origin would let
  // an attacker craft a reset link that lands the victim on a phishing clone
  // of the login page. Allow only the public site and *.gymflow.ng subdomains.
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';
  let safeOrigin = site;
  try {
    const u = new URL(originUrl);
    const siteHost = new URL(site).host;
    if (u.host === siteHost || u.host.endsWith('.gymflow.ng') || u.host === 'gymflow.ng') {
      safeOrigin = `${u.protocol}//${u.host}`;
    }
  } catch {
    // fall back to site
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${safeOrigin}/auth/callback?next=/reset-password`,
  });
  return { error: error?.message ?? null };
}

export type UpdatePasswordState = { error: string } | undefined;

// Set a new password. Reached only after /auth/callback has exchanged the
// recovery code for a session, so getUser() must return the recovering user.
export async function updatePassword(_prev: UpdatePasswordState, formData: FormData): Promise<UpdatePasswordState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (password !== confirm) return { error: 'Passwords do not match.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your reset link has expired. Please request a new one.' };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('different from the old')) {
      return { error: 'Your new password must be different from your current one.' };
    }
    return { error: error.message };
  }

  // Sign the recovery session out so the user re-authenticates with the new password.
  await supabase.auth.signOut();
  redirect('/login?updated=1');
}

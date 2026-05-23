'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleHome } from './dal';
import { sendWelcome } from '@/lib/email';
import { waWelcome } from '@/lib/whatsapp';

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

  // Fire-and-forget welcome notifications. Errors logged, not surfaced —
  // the user shouldn't be blocked from signing in just because Resend hiccupped.
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

  redirect(`/login?welcome=1${gymSlug ? `&gym=${encodeURIComponent(gymSlug)}` : ''}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function requestPasswordReset(email: string, originUrl: string): Promise<{ error: string | null }> {
  if (!email) return { error: 'Enter your email first' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${originUrl}/login?reset=1`,
  });
  return { error: error?.message ?? null };
}

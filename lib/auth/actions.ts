'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleHome } from './dal';

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

  const supabase = await createClient();
  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
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

  const userId = signUpData.user?.id;
  if (!userId) {
    return { error: 'Sign-up succeeded but no user id was returned.' };
  }

  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.join(' ') || null;

  await supabase.from('profiles').upsert(
    {
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      phone,
      role: 'member',
      date_of_birth: dateOfBirth,
      gender,
      address,
      nok_name: nokName,
      nok_relationship: nokRelationship,
      nok_phone: nokPhone,
      nok_address: nokAddress,
      health_notes: healthNotes,
      waiver_signed_at: waiverSigned ? new Date().toISOString() : null,
      is_active: true,
    },
    { onConflict: 'id' },
  );

  if (gymSlug) {
    const { data: gym } = await supabase.from('gyms').select('id').eq('slug', gymSlug).maybeSingle();
    if (gym) {
      await supabase
        .from('gym_member_links')
        .upsert(
          { gym_id: gym.id, user_id: userId, onboarding_method: 'self_signup' },
          { onConflict: 'gym_id,user_id' },
        );
    }
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

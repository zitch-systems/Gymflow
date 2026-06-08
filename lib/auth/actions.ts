'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type AuthState = { error: string | null };

// Sign in with email + password, then route by role (member/staff/platform).
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // Route by role: platform admin → /superadmin, staff → /admin, else member.
  // Use the user from the sign-in response — avoids a second auth round-trip
  // (every extra Supabase call widens the cold-start window that can 504).
  const user = data.user;
  if (user) {
    const [{ data: pa }, { data: staff }] = await Promise.all([
      supabase.from('platform_admins').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
      supabase.from('gym_staff_links').select('role').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    ]);
    if (pa) redirect('/superadmin');
    if (staff) redirect((staff as { role: string }).role === 'instructor' ? '/coach' : '/admin');
  }
  redirect('/dashboard');
}

// Create a gym workspace + owner account. Provisions auth user; the gym row +
// owner staff link are created by a DB trigger / onboarding flow (service role).
export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const gymName = String(formData.get('gym') ?? '').trim();
  if (!email || !password) return { error: 'Enter your email and password.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/login`,
      data: { gym_name: gymName },
    },
  });
  if (error) return { error: error.message };
  redirect('/login?check-email=1');
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

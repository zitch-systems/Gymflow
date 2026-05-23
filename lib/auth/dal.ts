import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  return data ?? null;
});

// platform_admin status lives in TWO places that can drift:
//   - profiles.role = 'platform_admin' (denormalized, used by app guards)
//   - platform_admins row with user_id (authoritative per spec §3.1, used by RLS)
// Treat either signal as proof so a misconfigured user is recoverable.
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getSessionUser();
  if (!user) return false;
  const supabase = await createClient();
  const profile = await getProfile();
  if (profile?.role === 'platform_admin') return true;
  const { data: pa } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  return !!pa;
});

export async function requireAuth(redirectTo?: string) {
  const user = await getSessionUser();
  if (!user) {
    const target = redirectTo
      ? `/login?redirect=${encodeURIComponent(redirectTo)}`
      : '/login';
    redirect(target);
  }
  return user!;
}

export type Role =
  | 'member'
  | 'instructor'
  | 'front_desk'
  | 'accountant'
  | 'manager'
  | 'owner'
  | 'gym_owner'
  | 'platform_admin';

export const ADMIN_ROLES: Role[] = ['gym_owner', 'owner', 'manager', 'front_desk', 'accountant'];

export function roleHome(role: Role | string | null | undefined): string {
  if (role === 'platform_admin') return '/superadmin';
  if (role === 'instructor') return '/instructor';
  if (role && ADMIN_ROLES.includes(role as Role)) return '/admin/dashboard';
  return '/dashboard';
}

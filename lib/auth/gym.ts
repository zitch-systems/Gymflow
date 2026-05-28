import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser, type Role } from './dal';
import type { Database } from '@/lib/database.types';

type Gym = Database['public']['Tables']['gyms']['Row'];

export const getGymBySlug = cache(async (slug: string): Promise<Gym | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('gyms')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.warn('[GF] getGymBySlug error:', error.message);
    return null;
  }
  return data ?? null;
});

export async function requireGym(slug: string): Promise<Gym> {
  const gym = await getGymBySlug(slug);
  if (!gym) redirect('/');
  return gym!;
}

/**
 * A gym is operational only when status='active' AND subscription_status is not
 * 'cancelled'. past_due is intentionally allowed: the renewals cron is mid-retry
 * and a hard cutoff would lock out members who paid on time for a billing issue
 * they didn't cause. Suspended/inactive/cancelled all block.
 *
 * Exported so the suspension policy is unit-testable and a future caller
 * (e.g. an API route) can apply the same rule without reaching into the guard.
 */
export function gymIsOperational(gym: Gym): boolean {
  if (gym.status && gym.status !== 'active') return false;
  if (gym.subscription_status === 'cancelled') return false;
  return true;
}

export async function requireMember(slug: string) {
  const gym = await requireGym(slug);
  if (!gymIsOperational(gym)) redirect(`/gym/${slug}/login?suspended=1`);
  const user = await getSessionUser();
  if (!user) redirect(`/gym/${slug}/login`);
  const supabase = await createClient();
  const { data } = await supabase
    .from('gym_member_links')
    .select('*')
    .eq('user_id', user.id)
    .eq('gym_id', gym.id)
    .maybeSingle();
  if (!data) redirect(`/gym/${slug}/login`);
  return { user, gym, link: data };
}

export async function getStaffRole(slug: string): Promise<Role | null> {
  const gym = await getGymBySlug(slug);
  if (!gym) return null;
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  // platform_admin is the only GLOBAL role — it grants cross-gym support access.
  // Every other role MUST be proven by a per-gym link, otherwise an owner of
  // gym A (profiles.role='owner') could reach gym B's admin portal.
  if (profile?.role === 'platform_admin') return 'platform_admin';

  const { data: staffRow } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .maybeSingle();

  if (staffRow?.role) return staffRow.role as Role;

  const { data: link } = await supabase
    .from('gym_staff_links')
    .select('role')
    .eq('user_id', user.id)
    .eq('gym_id', gym.id)
    .maybeSingle();

  if (link?.role) return link.role as Role;
  return null;
}

// Roles that may change money-sensitive settings (payout bank, etc.).
const MANAGER_ROLES: Role[] = ['gym_owner', 'owner', 'manager', 'platform_admin'];

export async function requireManager(slug: string) {
  const { role, gym } = await requireStaff(slug);
  if (!MANAGER_ROLES.includes(role as Role)) redirect(`/gym/${slug}/admin`);
  return { role, gym };
}

export async function requireStaff(slug: string) {
  const role = await getStaffRole(slug);
  if (!role || role === 'member') redirect(`/gym/${slug}/login`);
  const gym = await getGymBySlug(slug);
  // platform_admin retains support access even on suspended/cancelled gyms —
  // they need it to unsuspend or terminate from the superadmin. Local owners
  // and other staff get blocked just like members.
  if (gym && !gymIsOperational(gym) && role !== 'platform_admin') {
    redirect(`/gym/${slug}/login?suspended=1`);
  }
  return { role, gym: gym! };
}

export async function requireInstructor(slug: string) {
  const gym = await requireGym(slug);
  if (!gymIsOperational(gym)) redirect(`/gym/${slug}/login?suspended=1`);
  const user = await getSessionUser();
  if (!user) redirect(`/gym/${slug}/login`);
  const supabase = await createClient();

  const { data: link } = await supabase
    .from('gym_staff_links')
    .select('user_id, role, is_active')
    .eq('user_id', user.id)
    .eq('gym_id', gym.id)
    .eq('role', 'instructor')
    .eq('is_active', true)
    .maybeSingle();

  if (!link) redirect(`/gym/${slug}/login`);
  return { user, gym, link };
}

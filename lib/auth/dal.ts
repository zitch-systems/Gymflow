import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';

type Gym = Database['public']['Tables']['gyms']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

// ── Session ──────────────────────────────────────────────────────────────
// getUser is cached per-request so multiple callers share one auth round-trip.
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  return data;
});

export async function requireAuth() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

// ── Role gates ───────────────────────────────────────────────────────────
// Routes are flat (no /[slug]); resolve the user's gym from their links.

export async function requireMember(): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getUser>>>; gym: Gym; link: Database['public']['Tables']['gym_member_links']['Row'] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: link } = await supabase
    .from('gym_member_links')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let gym: Gym | null = null;
  if (link) {
    const { data: g } = await supabase
      .from('gyms')
      .select('*')
      .eq('id', (link as { gym_id: string }).gym_id)
      .maybeSingle();
    gym = (g as Gym | null) ?? null;
  }
  if (!link || !gym) redirect('/login');
  return { user, gym, link: link as Database['public']['Tables']['gym_member_links']['Row'] };
}

export async function requireStaff(roles?: string[]): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getUser>>>; gym: Gym; role: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: link } = await supabase
    .from('gym_staff_links')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  let gym: Gym | null = null;
  if (link) {
    const { data: g } = await supabase
      .from('gyms')
      .select('*')
      .eq('id', (link as { gym_id: string }).gym_id)
      .maybeSingle();
    gym = (g as Gym | null) ?? null;
  }
  const role = (link as unknown as { role: string } | null)?.role ?? '';
  if (!link || !gym || (roles && !roles.includes(role))) redirect('/login');
  return { user, gym, role };
}

// user_role enum: platform_admin | gym_owner | manager | front_desk | accountant | instructor | member
export async function requireInstructor() {
  return requireStaff(['instructor', 'manager', 'gym_owner']);
}

export async function isPlatformAdmin(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  return Boolean(data);
}

export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!data) redirect('/');
  return user;
}

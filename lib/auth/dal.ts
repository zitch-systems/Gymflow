import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';

type Gym = Database['public']['Tables']['gyms']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

// ── Session ──────────────────────────────────────────────────────────────
// All of these are wrapped in `cache()` so a single request that hits a layout
// AND its page (the common case) shares one resolution instead of running the
// auth + link + gym round-trips twice.

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
// Routes are flat (no /[slug]); we resolve the user's gym from their links.
//
// Each gate is cached() so the layout + page only pay for one resolution per
// request (a page like /admin/members runs requireStaff() in both the layout
// AND the page — previously that was two full auth+link+gym round-trip sets).
// Inside, the auth check reuses the cached getUser() rather than calling
// supabase.auth.getUser() again. Link + gym stay as two plain queries (not a
// PostgREST embed) because the embed failed silently once when FKs were missing
// on gym_staff_links (commit 81ab48e); the FK exists now but the explicit form
// is robust and the queries are indexed point-lookups.

// Staff roles allowed into the admin console + admin actions. Deliberately
// excludes 'instructor' — coaches get /coach, not member PII, payments, plans
// or gym settings. ('owner' is the profiles.role spelling; staff links use
// 'gym_owner' — both included defensively.)
export const ADMIN_ROLES = ['gym_owner', 'owner', 'manager', 'front_desk', 'accountant'] as const;
// Gym identity / pricing / classes — management only.
export const MANAGER_ROLES = ['gym_owner', 'owner', 'manager'] as const;

export const requireMember = cache(async (): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getUser>>>; gym: Gym; link: Database['public']['Tables']['gym_member_links']['Row'] }> => {
  const user = await getUser();
  if (!user) redirect('/login');
  const supabase = await createClient();
  // One round-trip: the membership link with its gym embedded via the
  // gym_member_links.gym_id → gyms FK. Falls back to a separate fetch if the
  // embed ever returns null, so it's never slower than the old two queries.
  const { data: link } = await supabase
    .from('gym_member_links')
    .select('*, gyms(*)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // Signed-in but not a member here → /launch routes them to their own surface
  // (staff → /admin, instructor → /coach) instead of a /login dead-end.
  if (!link) redirect('/launch');
  const { gyms: embeddedGym, ...linkRow } = link as Database['public']['Tables']['gym_member_links']['Row'] & { gyms: Gym | null };
  let gym: Gym | null = embeddedGym ?? null;
  if (!gym && linkRow.gym_id) {
    const { data } = await supabase.from('gyms').select('*').eq('id', linkRow.gym_id).maybeSingle();
    gym = (data as Gym) ?? null;
  }
  if (!gym) redirect('/launch');
  return { user, gym, link: linkRow as Database['public']['Tables']['gym_member_links']['Row'] };
});

// Internal staff resolver. Cached on `roles` so requireStaff() (any role) and
// the role-restricted variants each get a cache slot, and all dedupe the
// layout/page double-call.
const resolveStaff = cache(async (roles?: readonly string[]): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getUser>>>; gym: Gym; role: string }> => {
  const user = await getUser();
  if (!user) redirect('/login');
  const supabase = await createClient();
  const { data: link } = await supabase
    .from('gym_staff_links')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  // Signed-in but not staff (or wrong role) → /launch picks their real surface;
  // bouncing to /login used to trap signed-in users in a redirect loop.
  if (!link) redirect('/launch');
  const role = (link as unknown as { role: string }).role ?? '';
  if (roles && !roles.includes(role)) redirect('/launch');
  const { data: gym } = await supabase
    .from('gyms')
    .select('*')
    .eq('id', (link as { gym_id: string }).gym_id)
    .maybeSingle();
  if (!gym) redirect('/launch');
  return { user, gym: gym as Gym, role };
});

export async function requireStaff(roles?: readonly string[]) {
  return resolveStaff(roles);
}

// Admin console staff (everything except instructors).
export async function requireAdminStaff() {
  return resolveStaff(ADMIN_ROLES);
}

// user_role enum: platform_admin | gym_owner | manager | front_desk | accountant | instructor | member
const INSTRUCTOR_ROLES = ['instructor', 'manager', 'gym_owner'] as const;
export async function requireInstructor() {
  return resolveStaff(INSTRUCTOR_ROLES);
}

export const isPlatformAdmin = cache(async (): Promise<boolean> => {
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
});

export const requirePlatformAdmin = cache(async () => {
  const user = await getUser();
  if (!user) redirect('/login');
  const supabase = await createClient();
  const { data } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!data) redirect('/');
  return user;
});

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { gymLaunchUrl, memberBelongsOnGymSite } from '@/lib/web-signin';
import type { Database } from '@/lib/database.types';

type Gym = Database['public']['Tables']['gyms']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

// Cookie that pins which gym a multi-gym staff member is currently acting as.
export const ACTIVE_GYM_COOKIE = 'gf-active-gym';
async function readActiveGymCookie(): Promise<string | null> {
  try { return (await cookies()).get(ACTIVE_GYM_COOKIE)?.value ?? null; } catch { return null; }
}

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
  // select('*') stays: getProfile returns the whole Profile row wholesale (typed
  // Profile) to callers across the app, which read a wide, varying set of columns.
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
  // select('*') on both stays — requireMember returns the full link + Gym rows
  // wholesale to every member surface.
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
    // Fallback still returns the full Gym row wholesale — keep select('*').
    const { data } = await supabase.from('gyms').select('*').eq('id', linkRow.gym_id).maybeSingle();
    gym = (data as Gym) ?? null;
  }
  if (!gym) redirect('/launch');

  // The member surfaces live on the gym's own host, not on GymFlow's website.
  // This is the boundary, not the sign-in form: /login and /launch route people
  // to the right place, but a session minted before this rule existed — or by
  // any path that doesn't pass through them — would still open /dashboard on
  // the apex without it. Staff never reach here (requireStaff resolves them
  // first), and it no-ops off the production apex, so localhost and preview
  // deploys, where subdomains don't resolve, are unaffected.
  const host = (await headers()).get('x-forwarded-host') ?? (await headers()).get('host');
  if (memberBelongsOnGymSite(host, { isPlatformAdmin: false, isStaff: false, memberGymSlug: gym.slug })) {
    redirect(gymLaunchUrl(gym.slug));
  }

  return { user, gym, link: linkRow as Database['public']['Tables']['gym_member_links']['Row'] };
});

// Internal staff resolver. Cached on `roles` so requireStaff() (any role) and
// the role-restricted variants each get a cache slot, and all dedupe the
// layout/page double-call.
const resolveStaff = cache(async (roles?: readonly string[]): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getUser>>>; gym: Gym; role: string }> => {
  const user = await getUser();
  if (!user) redirect('/login');
  const supabase = await createClient();
  const { data: links } = await supabase
    .from('gym_staff_links')
    // Only gym_id + role are read below (eligibility filter + active-gym pick);
    // the gym row itself is fetched separately, so narrow instead of select('*').
    .select('gym_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    // Stable order so the default pick (first eligible) is deterministic.
    .order('created_at', { ascending: true });
  // Only links whose role is valid for THIS surface are eligible (e.g. an
  // instructor link is ineligible on /admin even if the user also owns a gym).
  const all = (links ?? []) as Array<{ gym_id: string | null; role: string | null }>;
  const eligible = (roles ? all.filter((l) => roles.includes(l.role ?? '')) : all).filter((l) => l.gym_id);
  // Signed-in but not staff (or wrong role here) → /launch picks their real
  // surface; bouncing to /login used to trap signed-in users in a redirect loop.
  if (eligible.length === 0) redirect('/launch');
  // Honour the active-gym cookie when it points at an eligible gym; else first.
  const activeId = await readActiveGymCookie();
  const chosen = eligible.find((l) => l.gym_id === activeId) ?? eligible[0];
  const role = chosen.role ?? '';
  // Full Gym row — requireStaff returns it wholesale to every admin surface, so
  // select('*') stays.
  const { data: gym } = await supabase
    .from('gyms')
    .select('*')
    .eq('id', chosen.gym_id as string)
    .maybeSingle();
  if (!gym) redirect('/launch');
  return { user, gym: gym as Gym, role };
});

// The set of gyms a staff member can act as on a given surface (the roles
// filter), plus which one is currently active. Powers the gym switcher; the
// switcher only renders when there's more than one.
export const getStaffGyms = cache(async (roles?: readonly string[]): Promise<{ gyms: { id: string; name: string }[]; activeId: string }> => {
  const user = await getUser();
  if (!user) return { gyms: [], activeId: '' };
  const supabase = await createClient();
  const { data: links } = await supabase
    .from('gym_staff_links')
    .select('gym_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  const all = (links ?? []) as Array<{ gym_id: string | null; role: string | null }>;
  const ids = (roles ? all.filter((l) => roles.includes(l.role ?? '')) : all)
    .map((l) => l.gym_id).filter((id): id is string => !!id);
  if (ids.length === 0) return { gyms: [], activeId: '' };
  const { data: gymRows } = await supabase.from('gyms').select('id, name').in('id', ids);
  const nameById = new Map((gymRows ?? []).map((g) => [g.id, g.name]));
  const gyms = ids.map((id) => ({ id, name: nameById.get(id) ?? 'Gym' }));
  const activeId = await readActiveGymCookie();
  return { gyms, activeId: gyms.find((g) => g.id === activeId)?.id ?? gyms[0].id };
});

export async function requireStaff(roles?: readonly string[]) {
  return resolveStaff(roles);
}

// Admin console staff (everything except instructors).
export async function requireAdminStaff() {
  return resolveStaff(ADMIN_ROLES);
}

// user_role enum: platform_admin | gym_owner | manager | front_desk | accountant | instructor | member
export const INSTRUCTOR_ROLES = ['instructor', 'manager', 'gym_owner'] as const;
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
  // Signed in, but not on the platform-admin list. Sending them to `/` dropped
  // them on the marketing landing page with no explanation — indistinguishable
  // from a broken link, and the usual cause is simply being signed in on a gym
  // account instead of the platform one. Send them somewhere they can act:
  // the platform sign-in, with a notice saying which account they need.
  if (!data) redirect('/login?denied=platform');
  return user;
});

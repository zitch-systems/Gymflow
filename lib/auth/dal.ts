import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
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
// Dedupe happens on the PRIMITIVES (getUser / fetchStaffLinks / gymById are
// cache()d, argument-free or keyed by string id) rather than on the gate
// functions themselves — so a layout calling requireAdminStaff() and its page
// calling requireStaff() still share one auth check, one links query and one
// gym lookup per request. Link + gym stay as two plain queries (not a
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

// One staff-links fetch per request, shared by EVERY gate variant. The old
// resolver was cache()d on its `roles` argument — but cache() keys on argument
// identity, so a layout calling requireAdminStaff() (ADMIN_ROLES) and a page
// calling requireStaff() (undefined) landed in different slots and the
// links + gym queries ran twice per navigation. Caching the raw fetch (no
// args) and filtering roles in memory restores real per-request dedupe.
const fetchStaffLinks = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('gym_staff_links')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    // Stable order so the default pick (first eligible) is deterministic.
    .order('created_at', { ascending: true });
  return { user, links: (data ?? []) as Array<{ gym_id: string | null; role: string | null }> };
});

// Gym rows dedupe by id (cache() compares string args by value), so the
// layout's gate and the page's gate share one lookup.
const gymById = cache(async (id: string): Promise<Gym | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('gyms').select('*').eq('id', id).maybeSingle();
  return (data as Gym) ?? null;
});

// Internal staff resolver — plain function; everything it awaits is cached.
async function resolveStaff(roles?: readonly string[]): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getUser>>>; gym: Gym; role: string }> {
  const staff = await fetchStaffLinks();
  if (!staff) redirect('/login');
  // Only links whose role is valid for THIS surface are eligible (e.g. an
  // instructor link is ineligible on /admin even if the user also owns a gym).
  const eligible = (roles ? staff.links.filter((l) => roles.includes(l.role ?? '')) : staff.links).filter((l) => l.gym_id);
  // Signed-in but not staff (or wrong role here) → /launch picks their real
  // surface; bouncing to /login used to trap signed-in users in a redirect loop.
  if (eligible.length === 0) redirect('/launch');
  // Honour the active-gym cookie when it points at an eligible gym; else first.
  const activeId = await readActiveGymCookie();
  const chosen = eligible.find((l) => l.gym_id === activeId) ?? eligible[0];
  const role = chosen.role ?? '';
  const gym = await gymById(chosen.gym_id as string);
  if (!gym) redirect('/launch');
  return { user: staff.user, gym, role };
}

// The set of gyms a staff member can act as on a given surface (the roles
// filter), plus which one is currently active. Powers the gym switcher; the
// switcher only renders when there's more than one.
export const getStaffGyms = cache(async (roles?: readonly string[]): Promise<{ gyms: { id: string; name: string }[]; activeId: string }> => {
  // Reuses the request-cached links fetch instead of re-querying gym_staff_links.
  const staff = await fetchStaffLinks();
  if (!staff) return { gyms: [], activeId: '' };
  const ids = (roles ? staff.links.filter((l) => roles.includes(l.role ?? '')) : staff.links)
    .map((l) => l.gym_id).filter((id): id is string => !!id);
  if (ids.length === 0) return { gyms: [], activeId: '' };
  const supabase = await createClient();
  const { data: gymRows } = await supabase.from('gyms').select('id, name').in('id', ids);
  const nameById = new Map((gymRows ?? []).map((g) => [g.id, g.name]));
  const gyms = ids.map((id) => ({ id, name: nameById.get(id) ?? 'Gym' }));
  const activeId = await readActiveGymCookie();
  return { gyms, activeId: gyms.find((g) => g.id === activeId)?.id ?? gyms[0].id };
});

// Bare requireStaff() means "admin-console staff", NOT "any staff role":
// with no filter, a user holding an older instructor link at another gym
// would have eligible[0] resolve to THAT gym — an admin page would then
// render gym X's data inside gym Y's shell, and an instructor-role link
// would reach member PII that ADMIN_ROLES deliberately excludes.
export async function requireStaff(roles: readonly string[] = ADMIN_ROLES) {
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
  if (!data) redirect('/');
  return user;
});

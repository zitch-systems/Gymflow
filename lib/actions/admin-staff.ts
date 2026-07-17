'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitName } from '@/lib/format';
import { logAudit } from '@/lib/audit';

export type StaffState = { ok: boolean; error: string | null; message?: string; tempPassword?: string; email?: string };

// Who may add staff (owner/manager), and which roles they may assign.
const MANAGER_ROLES = ['gym_owner', 'owner', 'manager'] as const;
// gym_staff_links.role values (user_role enum) — gym_owner is excluded (a gym
// already has its owner).
const STAFF_ROLES = new Set(['manager', 'front_desk', 'accountant', 'instructor']);
// gym_staff_links.role → profiles.role (which only allows owner/manager/staff/
// instructor/member/platform_admin). front_desk & accountant map to 'staff'.
const PROFILE_ROLE: Record<string, string> = { manager: 'manager', instructor: 'instructor', front_desk: 'staff', accountant: 'staff' };

function tempPassword(): string {
  return `Gym-${Math.random().toString(36).slice(2, 8)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// Add a staff member to the caller's gym: create (or link an existing) account,
// set their profile role + gym, and create the gym_staff_links row. Owner/manager
// only. Needs SUPABASE_SERVICE_ROLE_KEY (auth user creation + RLS-locked writes).
export async function inviteStaff(_prev: StaffState, formData: FormData): Promise<StaffState> {
  let actorId: string, gymId: string, gymName: string;
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    actorId = user.id; gymId = gym.id; gymName = gym.name;
  } catch {
    return { ok: false, error: 'Only an owner or manager can add staff.' };
  }

  const fullName = String(formData.get('full_name') ?? '').trim().slice(0, 120);
  const email = String(formData.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  const role = String(formData.get('role') ?? '');
  if (!fullName || !email) return { ok: false, error: 'Name and email are required.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!STAFF_ROLES.has(role)) return { ok: false, error: 'Choose a valid role.' };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Adding staff needs SUPABASE_SERVICE_ROLE_KEY set in the server env.' };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // Reuse an existing account with this email, else create one with a temp
  // password the owner can share.
  let uid: string | null = null;
  let pwd: string | undefined;
  const { data: existing } = await admin.from('profiles').select('id, gym_id').eq('email', email).maybeSingle();
  if (existing) {
    uid = (existing as { id: string }).id;
    // SECURITY: never rewrite an existing account's profile (role/gym_id) from
    // here. This runs with the service-role client (RLS bypassed), so an
    // owner/manager could otherwise enter ANY existing user's email and hijack
    // their profile — repointing their gym or downgrading their role. Access on
    // the admin surface is granted by the gym_staff_links row below, not by
    // profiles.role/gym_id, so the link alone is sufficient and safe. Refuse if
    // the account already belongs to a DIFFERENT gym to avoid cross-tenant link
    // attachment without the other gym's involvement.
    const existingGym = (existing as { gym_id: string | null }).gym_id;
    if (existingGym && existingGym !== gymId) {
      return { ok: false, error: 'That email already belongs to another gym’s account. Ask them to leave it first, or use a different email.' };
    }
  } else {
    pwd = tempPassword();
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email, password: pwd, email_confirm: true, user_metadata: { full_name: fullName, gym_id: gymId },
    });
    if (authErr || !created?.user) return { ok: false, error: authErr?.message ?? 'Could not create the staff account.' };
    uid = created.user.id;
    // Profile (role + gym) — only for the brand-new account we just minted.
    // full_name is GENERATED in the DB — write split parts.
    const { error: pErr } = await admin.from('profiles').upsert({ id: uid, email, ...splitName(fullName), role: PROFILE_ROLE[role], gym_id: gymId });
    if (pErr) return { ok: false, error: pErr.message };
  }
  if (!uid) return { ok: false, error: 'Could not resolve the staff account.' };

  // Staff link — idempotent (reactivate/repoint if it already exists).
  const { data: link } = await admin.from('gym_staff_links').select('id').eq('user_id', uid).eq('gym_id', gymId).maybeSingle();
  if (link) {
    await admin.from('gym_staff_links').update({ role: role as never, is_active: true }).eq('id', (link as { id: string }).id);
  } else {
    const { error: lErr } = await admin.from('gym_staff_links').insert({ user_id: uid, gym_id: gymId, role: role as never, is_active: true });
    if (lErr) return { ok: false, error: lErr.message };
  }

  logAudit({ action: 'staff_added', table: 'gym_staff_links', actorId, gymId, recordId: uid, values: { email, role } });
  revalidatePath('/admin/instructors');
  return {
    ok: true,
    error: null,
    message: pwd ? `${fullName} added to ${gymName}. Share their sign-in details below.` : `${fullName} was linked to ${gymName}.`,
    tempPassword: pwd,
    email: pwd ? email : undefined,
  };
}

// Activate or deactivate a staff member's access to the caller's gym. Flips
// gym_staff_links.is_active — a deactivated staffer keeps their account but
// loses admin/coach access (requireStaff filters on is_active). Owner/manager
// only; the gym owner's own link can't be deactivated, and you can't deactivate
// yourself (avoids locking the last manager out).
export async function setStaffActive(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const targetUserId = String(formData.get('user_id') ?? '');
  const active = formData.get('active') === 'on' || String(formData.get('active')) === 'true';
  if (!targetUserId) return { ok: false, error: 'Missing staff member.' };
  let actorId: string, gymId: string;
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    actorId = user.id; gymId = gym.id;
  } catch {
    return { ok: false, error: 'Only an owner or manager can manage staff.' };
  }
  if (targetUserId === actorId) return { ok: false, error: 'You can’t change your own access.' };
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const { data: link } = await admin.from('gym_staff_links').select('id, role').eq('user_id', targetUserId).eq('gym_id', gymId).maybeSingle();
  if (!link) return { ok: false, error: 'That person isn’t staff at this gym.' };
  if ((link as { role: string }).role === 'gym_owner') return { ok: false, error: 'The gym owner’s access can’t be changed here.' };

  const { error } = await admin.from('gym_staff_links').update({ is_active: active }).eq('id', (link as { id: string }).id);
  if (error) return { ok: false, error: error.message };
  logAudit({ action: active ? 'staff_activated' : 'staff_deactivated', table: 'gym_staff_links', actorId, gymId, recordId: targetUserId });
  revalidatePath('/admin/instructors');
  return { ok: true, error: null, message: active ? 'Staff access restored.' : 'Staff access revoked.' };
}

// Change a staff member's role (elevate/demote) at the caller's gym. Owner/
// manager only; can't assign gym_owner and can't change the existing owner.
// Also keeps profiles.role roughly aligned so downstream role reads agree.
export async function setStaffRole(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const targetUserId = String(formData.get('user_id') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!targetUserId) return { ok: false, error: 'Missing staff member.' };
  if (!STAFF_ROLES.has(role)) return { ok: false, error: 'Choose a valid role.' };
  let actorId: string, gymId: string;
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    actorId = user.id; gymId = gym.id;
  } catch {
    return { ok: false, error: 'Only an owner or manager can manage staff.' };
  }
  if (targetUserId === actorId) return { ok: false, error: 'You can’t change your own role.' };
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const { data: link } = await admin.from('gym_staff_links').select('id, role').eq('user_id', targetUserId).eq('gym_id', gymId).maybeSingle();
  if (!link) return { ok: false, error: 'That person isn’t staff at this gym.' };
  if ((link as { role: string }).role === 'gym_owner') return { ok: false, error: 'The gym owner’s role can’t be changed here.' };

  const { error } = await admin.from('gym_staff_links').update({ role: role as never }).eq('id', (link as { id: string }).id);
  if (error) return { ok: false, error: error.message };
  // Keep the account's profile role aligned for this gym (only if the profile
  // points at this gym — never touch a profile that belongs elsewhere).
  await admin.from('profiles').update({ role: PROFILE_ROLE[role] as never }).eq('id', targetUserId).eq('gym_id', gymId);
  logAudit({ action: 'staff_role_changed', table: 'gym_staff_links', actorId, gymId, recordId: targetUserId, values: { role } });
  revalidatePath('/admin/instructors');
  return { ok: true, error: null, message: 'Role updated.' };
}

// Reset a staff member's password (for someone who forgot their login). Mints a
// fresh temporary password via the service role and returns it once so the
// owner/manager can hand it over — the staff member changes it after signing
// in. Owner/manager only; you can't reset your own password here (use "Forgot
// password?" on the login page), and the gym owner's password can't be reset
// from here (a manager must not be able to take over the owner's account).
export async function resetStaffPassword(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const targetUserId = String(formData.get('user_id') ?? '');
  if (!targetUserId) return { ok: false, error: 'Missing staff member.' };
  let actorId: string, gymId: string;
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    actorId = user.id; gymId = gym.id;
  } catch {
    return { ok: false, error: 'Only an owner or manager can reset staff passwords.' };
  }
  if (targetUserId === actorId) return { ok: false, error: 'Use “Forgot password?” on the login page to reset your own password.' };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Resetting passwords needs SUPABASE_SERVICE_ROLE_KEY set in the server env.' };
  }
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // Target must be staff at THIS gym and never the owner.
  const { data: link } = await admin.from('gym_staff_links').select('id, role').eq('user_id', targetUserId).eq('gym_id', gymId).maybeSingle();
  if (!link) return { ok: false, error: 'That person isn’t staff at this gym.' };
  if ((link as { role: string }).role === 'gym_owner') return { ok: false, error: 'The gym owner’s password can’t be reset here.' };

  const { data: prof } = await admin.from('profiles').select('email').eq('id', targetUserId).maybeSingle();
  const pwd = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(targetUserId, { password: pwd });
  if (error) return { ok: false, error: error.message };

  logAudit({ action: 'staff_password_reset', table: 'gym_staff_links', actorId, gymId, recordId: targetUserId });
  return {
    ok: true,
    error: null,
    message: 'New temporary password generated.',
    tempPassword: pwd,
    email: (prof as { email: string | null } | null)?.email ?? undefined,
  };
}

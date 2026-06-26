'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitName } from '@/lib/format';
import { logAudit } from '@/lib/audit';

export type StaffState = { ok: boolean; error: string | null; message?: string; tempPassword?: string };

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
  const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (existing) {
    uid = (existing as { id: string }).id;
  } else {
    pwd = tempPassword();
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email, password: pwd, email_confirm: true, user_metadata: { full_name: fullName, gym_id: gymId },
    });
    if (authErr || !created?.user) return { ok: false, error: authErr?.message ?? 'Could not create the staff account.' };
    uid = created.user.id;
  }
  if (!uid) return { ok: false, error: 'Could not resolve the staff account.' };

  // Profile (role + gym). full_name is GENERATED in the DB — write split parts.
  const { error: pErr } = await admin.from('profiles').upsert({ id: uid, email, ...splitName(fullName), role: PROFILE_ROLE[role], gym_id: gymId });
  if (pErr) return { ok: false, error: pErr.message };

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
  };
}

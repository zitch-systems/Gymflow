'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

// Membership freeze — staff-approved flow.
//
// Member requests: /dashboard route sets status='pause_requested'.
// Staff approves: status='paused', paused_at=now(). Denies: back to 'active'.
// Staff resumes: status='active', end_date extended by the frozen duration so
//   the member gets back the days they lost, then paused_at cleared.
//
// Writes to memberships are service-role-only by table policy, so the member's
// request goes through the admin client. Staff writes to member_subscriptions
// go through the RLS-scoped client (msub_update_staff policy authorises them).

export type ActionState = { ok: boolean; error: string | null; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentMemberSub(userId: string, gymId: string) {
  // Prefer an active/pause_requested/paused sub; ignore expired history.
  const admin = createAdminClient();
  const { data } = await admin
    .from('member_subscriptions')
    .select('id, status, end_date, paused_at, pause_reason')
    .eq('gym_id', gymId).eq('member_id', userId)
    .in('status', ['active', 'pause_requested', 'paused'])
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// Member requests a freeze. Only allowed when the member has an active sub.
export async function requestFreeze(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').slice(0, 500);
  try {
    const { user, gym } = await requireMember();
    const sub = await currentMemberSub(user.id, gym.id);
    if (!sub) return { ok: false, error: 'No active membership to freeze.' };
    if (sub.status !== 'active') {
      return { ok: false, error: sub.status === 'pause_requested'
        ? 'Freeze already requested — waiting for staff approval.'
        : 'Membership is already paused.' };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('member_subscriptions')
      .update({ status: 'pause_requested', pause_reason: reason || null })
      .eq('id', sub.id);
    if (error) return { ok: false, error: error.message };

    void logAudit({
      action: 'membership_freeze_requested',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { reason: reason || null },
    });
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/profile');
    return { ok: true, error: null, message: 'Freeze requested. Staff will review shortly.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Staff decides on a pending freeze request.
export async function approveFreeze(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    // Load the row scoped to this gym; RLS also enforces this but we need the
    // status to sanity-check the transition.
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, status, member_id')
      .eq('id', subId).eq('gym_id', gym.id).maybeSingle();
    if (!sub) return { ok: false, error: 'Subscription not found in this gym.' };
    if (sub.status !== 'pause_requested') return { ok: false, error: 'No pending freeze request on this membership.' };

    const { error } = await supabase
      .from('member_subscriptions')
      .update({ status: 'paused', paused_at: new Date().toISOString() })
      .eq('id', sub.id);
    if (error) return { ok: false, error: error.message };

    void logAudit({
      action: 'membership_freeze_approved',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { member_id: sub.member_id },
    });
    revalidatePath(`/admin/members/${sub.member_id}`);
    return { ok: true, error: null, message: 'Membership frozen.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function denyFreeze(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, status, member_id')
      .eq('id', subId).eq('gym_id', gym.id).maybeSingle();
    if (!sub) return { ok: false, error: 'Subscription not found in this gym.' };
    if (sub.status !== 'pause_requested') return { ok: false, error: 'No pending freeze request on this membership.' };

    const { error } = await supabase
      .from('member_subscriptions')
      .update({ status: 'active', pause_reason: null })
      .eq('id', sub.id);
    if (error) return { ok: false, error: error.message };

    void logAudit({
      action: 'membership_freeze_denied',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { member_id: sub.member_id },
    });
    revalidatePath(`/admin/members/${sub.member_id}`);
    return { ok: true, error: null, message: 'Freeze request denied.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Resume a paused membership. Compensates the member by adding the frozen
// duration (paused_at → now, whole days) to end_date so no time is lost.
export async function resumeFreeze(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, status, member_id, end_date, paused_at')
      .eq('id', subId).eq('gym_id', gym.id).maybeSingle();
    if (!sub) return { ok: false, error: 'Subscription not found in this gym.' };
    if (sub.status !== 'paused') return { ok: false, error: 'Membership is not currently paused.' };

    // Days added back = ceil((now - paused_at) / 1 day). Ceil so a partial
    // day doesn't shortchange the member. If paused_at is missing (shouldn't
    // happen — approveFreeze always sets it) we conservatively add 0 days.
    const pausedAt = sub.paused_at ? new Date(sub.paused_at) : null;
    const days = pausedAt ? Math.max(0, Math.ceil((Date.now() - pausedAt.getTime()) / 86400000)) : 0;
    const baseIso = sub.end_date ?? new Date().toISOString().slice(0, 10);
    const base = new Date(baseIso + 'T00:00:00Z');
    base.setUTCDate(base.getUTCDate() + days);
    const newEnd = base.toISOString().slice(0, 10);

    const { error } = await supabase
      .from('member_subscriptions')
      .update({ status: 'active', paused_at: null, pause_reason: null, end_date: newEnd })
      .eq('id', sub.id);
    if (error) return { ok: false, error: error.message };

    void logAudit({
      action: 'membership_freeze_resumed',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { member_id: sub.member_id, days_credited: days, new_end_date: newEnd },
    });
    revalidatePath(`/admin/members/${sub.member_id}`);
    return { ok: true, error: null, message: `Resumed. Added ${days} day${days === 1 ? '' : 's'}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

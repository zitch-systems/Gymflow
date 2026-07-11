'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

// Membership freeze — staff-approved flow with an explicit date window.
//
// Member requests: /dashboard route sets status='pause_requested' (only when the
//   gym has member_freeze_enabled — otherwise the request is rejected).
// Staff freeze/approve: status='paused', paused_at=now(), plus a pause_start →
//   pause_end window the resume credit is computed from.
// Staff resumes: status='active', end_date extended by the frozen days (capped
//   at the planned window) so the member gets back the days they lost.
//
// Writes to memberships are service-role-only by table policy, so the member's
// request goes through the admin client. Staff writes to member_subscriptions
// go through the RLS-scoped client (msub_update_staff policy authorises them).

export type ActionState = { ok: boolean; error: string | null; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parse a YYYY-MM-DD form value into a validated ISO date string (UTC midnight),
// or null if it isn't a real calendar date.
function parseDate(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? '').trim();
  if (!DATE_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

// Minimum days that must remain on the membership to accept a freeze request.
// A freeze doesn't buy new days — resume just credits back the pause window —
// so freezing right before expiry gives the member nothing back. Mirrors the
// admin "Expiring" cutoff used on /admin/members.
const MIN_DAYS_TO_FREEZE = 7;

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

// Member requests a freeze. Only allowed when the gym permits member freezes and
// the member has an active sub with meaningful time left. The requested window
// is stored on the sub so the admin's approval form pre-fills the same dates.
export async function requestFreeze(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '').slice(0, 500);
  const win = readWindow(formData);
  if ('error' in win) return { ok: false, error: win.error };
  try {
    const { user, gym } = await requireMember();
    if ((gym as { member_freeze_enabled?: boolean }).member_freeze_enabled === false) {
      return { ok: false, error: 'Your gym doesn’t offer self-service freezes. Ask staff to freeze your membership.' };
    }
    const sub = await currentMemberSub(user.id, gym.id);
    if (!sub) return { ok: false, error: 'No active membership to freeze.' };
    if (sub.status !== 'active') {
      return { ok: false, error: sub.status === 'pause_requested'
        ? 'Freeze already requested — waiting for staff approval.'
        : 'Membership is already paused.' };
    }
    // Reject freezes on lapsed or nearly-lapsed memberships — a freeze that
    // starts after expiry credits nothing back, and one with <7 days left
    // usually means the member should renew instead.
    if (!sub.end_date || daysBetween(todayIso(), sub.end_date) < MIN_DAYS_TO_FREEZE) {
      return { ok: false, error: 'Your membership has too little time left to freeze. Renew first.' };
    }
    // The freeze can't start after the membership ends — the days you'd get
    // back would land on an expired plan.
    if (daysBetween(todayIso(), win.start) > daysBetween(todayIso(), sub.end_date)) {
      return { ok: false, error: 'Freeze start date is after your membership ends. Pick an earlier date.' };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('member_subscriptions')
      .update({ status: 'pause_requested', pause_reason: reason || null, pause_start: win.start, pause_end: win.end })
      .eq('id', sub.id);
    if (error) return { ok: false, error: error.message };

    void logAudit({
      action: 'membership_freeze_requested',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { reason: reason || null, pause_start: win.start, pause_end: win.end },
    });
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/profile');
    return { ok: true, error: null, message: 'Freeze requested. Staff will review shortly.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Shared validation for the freeze date window (used by approve + direct freeze).
function readWindow(formData: FormData): { start: string; end: string } | { error: string } {
  const start = parseDate(formData.get('pauseStart')) ?? todayIso();
  const end = parseDate(formData.get('pauseEnd'));
  if (!end) return { error: 'Choose a valid resume (to) date.' };
  if (daysBetween(start, end) < 1) return { error: 'The resume date must be after the freeze start date.' };
  if (daysBetween(start, end) > 366) return { error: 'A freeze can’t be longer than a year.' };
  return { start, end };
}

// Staff freezes an active membership directly, specifying the from → to window.
export async function freezeMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  const reason = String(formData.get('reason') ?? '').slice(0, 500);
  const win = readWindow(formData);
  if ('error' in win) return { ok: false, error: win.error };
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, status, member_id')
      .eq('id', subId).eq('gym_id', gym.id).maybeSingle();
    if (!sub) return { ok: false, error: 'Subscription not found in this gym.' };
    if (sub.status !== 'active') return { ok: false, error: 'Only an active membership can be frozen.' };

    const { error } = await supabase
      .from('member_subscriptions')
      .update({ status: 'paused', paused_at: new Date().toISOString(), pause_start: win.start, pause_end: win.end, pause_reason: reason || null })
      .eq('id', sub.id);
    if (error) return { ok: false, error: error.message };

    void logAudit({
      action: 'membership_frozen',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { member_id: sub.member_id, pause_start: win.start, pause_end: win.end },
    });
    revalidatePath(`/admin/members/${sub.member_id}`);
    return { ok: true, error: null, message: `Frozen ${win.start} → ${win.end}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Staff approves a pending member freeze request, setting the from → to window.
export async function approveFreeze(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  const win = readWindow(formData);
  if ('error' in win) return { ok: false, error: win.error };
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
      .update({ status: 'paused', paused_at: new Date().toISOString(), pause_start: win.start, pause_end: win.end })
      .eq('id', sub.id);
    if (error) return { ok: false, error: error.message };

    void logAudit({
      action: 'membership_freeze_approved',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { member_id: sub.member_id, pause_start: win.start, pause_end: win.end },
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

// Days to credit a resuming membership: whole days from the freeze start up to
// the resume moment, but never past the planned window end. Falls back to the
// paused_at wall-clock for legacy rows with no explicit window.
function creditDays(sub: { pause_start: string | null; pause_end: string | null; paused_at: string | null }): number {
  if (sub.pause_start) {
    const startMs = Date.parse(sub.pause_start + 'T00:00:00Z');
    const plannedEndMs = sub.pause_end ? Date.parse(sub.pause_end + 'T00:00:00Z') : Number.POSITIVE_INFINITY;
    const endMs = Math.min(Date.now(), plannedEndMs);
    return Math.max(0, Math.ceil((endMs - startMs) / 86_400_000));
  }
  const pausedAt = sub.paused_at ? new Date(sub.paused_at) : null;
  return pausedAt ? Math.max(0, Math.ceil((Date.now() - pausedAt.getTime()) / 86_400_000)) : 0;
}

// Resume a paused membership. Compensates the member by adding the frozen days
// (capped at the planned window) to end_date so no time is lost.
export async function resumeFreeze(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, status, member_id, end_date, paused_at, pause_start, pause_end')
      .eq('id', subId).eq('gym_id', gym.id).maybeSingle();
    if (!sub) return { ok: false, error: 'Subscription not found in this gym.' };
    if (sub.status !== 'paused') return { ok: false, error: 'Membership is not currently paused.' };

    const days = creditDays(sub);
    const baseIso = sub.end_date ?? todayIso();
    const base = new Date(baseIso + 'T00:00:00Z');
    base.setUTCDate(base.getUTCDate() + days);
    const newEnd = base.toISOString().slice(0, 10);

    const { error } = await supabase
      .from('member_subscriptions')
      .update({ status: 'active', paused_at: null, pause_reason: null, pause_start: null, pause_end: null, end_date: newEnd })
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

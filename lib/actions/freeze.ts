'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { firstName, fmtDate, watDateISO } from '@/lib/format';
import type { EmailContent } from '@/lib/email/layout';
import { adminOrNull, getContact, getGymStaffEmails } from '@/lib/email/recipients';
import { memberAppUrl, platformAppUrl, sendGymEmail, sendPlatformEmail, type EmailCategory } from '@/lib/email/send';
import { MEMBER_TEMPLATES, freezeApproved, freezeDenied, freezeResumed, freezeStarted } from '@/lib/email/templates/member';
import { freezeRequested } from '@/lib/email/templates/platform';

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

// WAT, not UTC: freeze windows are validated against date-only columns that
// the rest of the app writes in WAT. Between 23:00–00:00 WAT a UTC "today"
// is already tomorrow, so a window could validate against the wrong day.
const todayIso = () => watDateISO();
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

// Minimum days that must remain on the membership to accept a freeze request.
// A freeze doesn't buy new days — resume just credits back the pause window —
// so freezing right before expiry gives the member nothing back. Mirrors the
// admin "Expiring" cutoff used on /admin/members.
const MIN_DAYS_TO_FREEZE = 7;

type Sb = Awaited<ReturnType<typeof createClient>>;
type StaffGym = Awaited<ReturnType<typeof requireStaff>>['gym'];

/**
 * Mail the member about a freeze decision staff just made.
 *
 * All four staff-side transitions below need the same thing — the member's
 * address, their own email opt-out, and a first name for the greeting — so the
 * lookup, the gate and the swallow live here once. The RESEND_API_KEY check
 * comes first: a gym with email switched off must not pay for a profile read on
 * every freeze. Staff read their own members' profiles under the existing RLS
 * policy, so no service role is involved.
 *
 * Swallows everything by design. A freeze is already written by the time this
 * runs, and a Resend outage must not turn a completed action into an error the
 * member's membership state doesn't match.
 */
async function mailMember(
  supabase: Sb,
  gym: StaffGym,
  memberId: string | null,
  spec: { template: string; category: EmailCategory },
  build: (name: string) => EmailContent,
): Promise<void> {
  if (!memberId || !process.env.RESEND_API_KEY) return;
  try {
    const { data } = await supabase
      .from('profiles').select('email, full_name, notification_email').eq('id', memberId).maybeSingle();
    const email = (data?.email ?? '').trim();
    if (!email) return;
    await sendGymEmail({
      gym,
      to: { email, fullName: data?.full_name ?? null, wantsEmail: data?.notification_email !== false },
      template: spec.template,
      category: spec.category,
      ...build(firstName(data?.full_name)),
    });
  } catch { /* bonus channel */ }
}

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

    // The request now sits in 'pause_requested' until a human decides, and
    // nothing on the staff side polls for that. Service role is not incidental:
    // a member cannot read gym_staff_links or another profile's email under RLS.
    // GymFlow-branded, not gym-branded — this goes to the people who RUN the gym.
    if (process.env.RESEND_API_KEY) {
      try {
        const emailAdmin = adminOrNull();
        if (emailAdmin) {
          const [staff, me] = await Promise.all([
            getGymStaffEmails(emailAdmin, gym.id),
            getContact(emailAdmin, user.id),
          ]);
          if (staff.length) {
            await sendPlatformEmail({
              to: staff,
              template: 'gym_freeze_requested',
              ...freezeRequested({
                gymName: gym.name,
                memberName: (me?.fullName ?? '').trim() || me?.email || 'A member',
                startDate: fmtDate(win.start),
                endDate: fmtDate(win.end),
                reason: reason || null,
                reviewUrl: platformAppUrl(`/admin/members/${user.id}`),
              }),
            });
          }
        }
      } catch { /* bonus channel — the request is already recorded */ }
    }

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

    // Staff froze this without the member asking, so the member finds out here
    // or at the door.
    await mailMember(supabase, gym, sub.member_id, MEMBER_TEMPLATES.freezeStarted, (name) => freezeStarted({
      gymName: gym.name,
      firstName: name,
      freezeStart: fmtDate(win.start),
      freezeEnd: fmtDate(win.end),
      dashboardUrl: memberAppUrl(gym),
      reason: reason || null,
    }));

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
    // status to sanity-check the transition. pause_reason is the member's own
    // words from the request — the approval mail quotes it back so the member
    // can see which request was approved.
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, status, member_id, pause_reason')
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

    await mailMember(supabase, gym, sub.member_id, MEMBER_TEMPLATES.freezeApproved, (name) => freezeApproved({
      gymName: gym.name,
      firstName: name,
      freezeStart: fmtDate(win.start),
      freezeEnd: fmtDate(win.end),
      dashboardUrl: memberAppUrl(gym),
      reason: sub.pause_reason,
    }));

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
    // end_date comes along because the refusal mail's whole reassurance is that
    // it hasn't moved.
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, status, member_id, end_date')
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

    await mailMember(supabase, gym, sub.member_id, MEMBER_TEMPLATES.freezeDenied, (name) => freezeDenied({
      gymName: gym.name,
      firstName: name,
      dashboardUrl: memberAppUrl(gym),
      endDate: sub.end_date ? fmtDate(sub.end_date) : null,
      // Deliberately blank. The form gives staff nowhere to write one, and the
      // only note on the row is the MEMBER's reason for asking — printing that
      // under "Reason" would read as the gym's grounds for refusing.
      reason: null,
    }));

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

    // Compare-and-swap on status: two concurrent resumes (cron + staff, or
    // two staff windows) would each read Date.now() a tick apart, compute
    // slightly different credits, and each write end_date — the second write
    // silently stamps an extra day on top of the first. Guarding on
    // status='paused' turns the second UPDATE into 0 rows; we then treat it
    // as "already resumed by another path" and return ok without re-crediting.
    const { data: swapped, error } = await supabase
      .from('member_subscriptions')
      .update({ status: 'active', paused_at: null, pause_reason: null, pause_start: null, pause_end: null, end_date: newEnd })
      .eq('id', sub.id).eq('status', 'paused').select('id').maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!swapped) return { ok: true, error: null, message: 'Already resumed.' };

    void logAudit({
      action: 'membership_freeze_resumed',
      table: 'member_subscriptions',
      actorId: user.id, gymId: gym.id, recordId: sub.id,
      values: { member_id: sub.member_id, days_credited: days, new_end_date: newEnd },
    });

    // The credited days are the point of the whole flow — a member who was never
    // told how many they got back has no way to check the gym kept its word.
    await mailMember(supabase, gym, sub.member_id, MEMBER_TEMPLATES.freezeResumed, (name) => freezeResumed({
      gymName: gym.name,
      firstName: name,
      daysCredited: days,
      newEndDate: fmtDate(newEnd),
      classesUrl: memberAppUrl(gym, '/classes'),
    }));

    revalidatePath(`/admin/members/${sub.member_id}`);
    return { ok: true, error: null, message: `Resumed. Added ${days} day${days === 1 ? '' : 's'}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

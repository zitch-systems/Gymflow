import 'server-only';
import type { AppSupabase } from '@/lib/api-app';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { fmtDate, watDateISO } from '@/lib/format';
import { getContact, getGymStaffEmails } from '@/lib/email/recipients';
import { platformAppUrl, sendPlatformEmail } from '@/lib/email/send';
import { freezeRequested } from '@/lib/email/templates/platform';

type Gym = { id: string; name: string; member_freeze_enabled?: boolean | null };
export type FreezeResult = { ok: boolean; error: string | null; message?: string };
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const realDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
};

export function memberFreezeWindow(startValue: unknown, endValue: unknown, today = watDateISO()): { start: string; end: string } | { error: string } {
  const start = startValue === '' || startValue == null ? today : realDate(startValue);
  const end = realDate(endValue);
  if (!start) return { error: 'Choose a valid freeze start date.' } as const;
  if (!end) return { error: 'Choose a valid resume date.' } as const;
  if (start < today) return { error: 'The freeze cannot start before today.' } as const;
  const days = daysBetween(start, end);
  if (days < 1) return { error: 'The resume date must be after the freeze start date.' } as const;
  if (days > 366) return { error: 'A freeze can’t be longer than a year.' } as const;
  return { start, end } as const;
}

/** Read with the authenticated caller's client; never return provider credentials. */
export async function memberMembershipState(supabase: AppSupabase, userId: string, gym: Gym) {
  const { data: sub, error } = await supabase.from('member_subscriptions')
    .select('id, status, start_date, end_date, pause_start, pause_end, pause_reason, auto_debit_enabled, paystack_subscription_code')
    .eq('member_id', userId).eq('gym_id', gym.id)
    .in('status', ['active', 'pause_requested', 'paused', 'past_due'])
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('Membership could not be loaded. Please try again.');
  const today = watDateISO();
  const enabled = gym.member_freeze_enabled !== false;
  let unavailable: string | null = null;
  if (!sub) unavailable = 'No active membership to freeze.';
  else if (sub.status === 'pause_requested') unavailable = 'Freeze requested — waiting for staff approval.';
  else if (sub.status === 'paused') unavailable = 'Your membership is frozen. Contact the gym to resume.';
  else if (!enabled) unavailable = 'Your gym doesn’t offer self-service freezes. Ask staff for help.';
  else if (sub.status !== 'active') unavailable = 'Resolve your membership payment before requesting a freeze.';
  else if (sub.start_date && sub.start_date > today) unavailable = 'You can request a freeze once your membership starts.';
  else if (!sub.end_date || daysBetween(today, sub.end_date) < 7) unavailable = 'Your membership has too little time left to freeze. Renew first.';
  return {
    today,
    gym: { id: gym.id, name: gym.name },
    subscription: sub ? {
      id: sub.id, status: sub.status, start_date: sub.start_date, end_date: sub.end_date,
      pause_start: sub.pause_start, pause_end: sub.pause_end, pause_reason: sub.pause_reason,
      auto_renew: sub.auto_debit_enabled === true,
    } : null,
    freeze: { enabled, can_request: unavailable === null, unavailable_reason: unavailable },
  };
}

/** Caller identity and gym must come from requireMember/requireApiMember. */
export async function requestMemberFreeze(
  supabase: AppSupabase, userId: string, gym: Gym,
  input: { start: unknown; end: unknown; reason: unknown },
): Promise<FreezeResult> {
  const win = memberFreezeWindow(input.start, input.end);
  if ('error' in win) return { ok: false, error: win.error };
  const state = await memberMembershipState(supabase, userId, gym);
  const sub = state.subscription;
  if (!sub || !state.freeze.can_request) return { ok: false, error: state.freeze.unavailable_reason };
  if (!sub.end_date || win.start > sub.end_date) return { ok: false, error: 'Freeze start date is after your membership ends. Pick an earlier date.' };
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
  const admin = createAdminClient();
  // Compare the state read above: a concurrent approval, cancellation or
  // renewal must not be overwritten, and repeated requests must send one notice.
  let update = admin.from('member_subscriptions')
    .update({ status: 'pause_requested', pause_start: win.start, pause_end: win.end, pause_reason: reason || null })
    .eq('id', sub.id).eq('gym_id', gym.id).eq('member_id', userId).eq('status', 'active').eq('end_date', sub.end_date);
  update = sub.start_date ? update.eq('start_date', sub.start_date) : update.is('start_date', null);
  const { data: saved, error } = await update.select('id').maybeSingle();
  if (error) return { ok: false, error: 'Your freeze request could not be saved. Please try again.' };
  if (!saved) return { ok: false, error: 'Your membership changed. Refresh before requesting a freeze.' };
  void logAudit({ action: 'membership_freeze_requested', table: 'member_subscriptions',
    actorId: userId, gymId: gym.id, recordId: sub.id,
    values: { reason: reason || null, pause_start: win.start, pause_end: win.end } });
  if (process.env.RESEND_API_KEY) {
    try {
      const [staff, me] = await Promise.all([getGymStaffEmails(admin, gym.id), getContact(admin, userId)]);
      if (staff.length) await sendPlatformEmail({ to: staff, template: 'gym_freeze_requested',
        ...freezeRequested({ gymName: gym.name, memberName: me?.fullName?.trim() || me?.email || 'A member',
          startDate: fmtDate(win.start), endDate: fmtDate(win.end), reason: reason || null,
          reviewUrl: platformAppUrl(`/admin/members/${userId}`) }) });
    } catch { /* A notice failure must not undo a saved request. */ }
  }
  return { ok: true, error: null, message: 'Freeze requested. Staff will review shortly.' };
}

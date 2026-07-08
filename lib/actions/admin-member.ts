'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { splitName } from '@/lib/format';
import { extendDate } from '@/lib/plan-duration';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActionState = { ok: boolean; error: string | null; message?: string };

const PAYMENT_METHODS = new Set(['card', 'bank_transfer', 'cash', 'crypto']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve the acting staff's gym + a member-scoped client, and verify the
// target member actually belongs to this gym. RLS (staff_* policies) is the
// real authority on the writes; this is the in-app guard + scoping.
async function ctx(memberId: string) {
  const { user, gym } = await requireStaff(ADMIN_ROLES);
  // memberId is interpolated into the PostgREST .or() filter below; reject
  // anything that isn't a clean UUID so it can't smuggle in extra filter terms.
  if (!UUID_RE.test(memberId)) throw new Error('Member not found in this gym.');
  const supabase = await createClient();
  const { data: link } = await supabase
    .from('gym_member_links')
    .select('id, is_active')
    .eq('gym_id', gym.id)
    .or(`member_id.eq.${memberId},user_id.eq.${memberId}`)
    .maybeSingle();
  if (!link) throw new Error('Member not found in this gym.');
  return { gymId: gym.id, supabase, actorId: user.id, isActive: link.is_active !== false };
}

// Extend the member's latest subscription by the plan duration (or create one).
async function extendSubscription(supabase: SupabaseClient, gymId: string, memberId: string, planId: string) {
  // Scope the plan to THIS gym — never trust a plan_id from the form to belong
  // to the caller's gym. A foreign plan id would otherwise leak another gym's
  // plan duration into this member's subscription.
  const { data: plan } = await supabase.from('membership_plans').select('duration_days, duration_months').eq('id', planId).eq('gym_id', gymId).maybeSingle();
  if (!plan) throw new Error('Plan not found in this gym.');
  const dur = { duration_days: plan?.duration_days ?? null, duration_months: plan?.duration_months ?? null };
  // Extend the latest ACTIVE sub only (mirrors the Paystack path in
  // paystack-fulfill.ts). Without the status filter a later-dated cancelled/
  // expired row could be picked and silently reactivated.
  const { data: sub } = await supabase
    .from('member_subscriptions').select('id, end_date')
    .eq('gym_id', gymId).eq('member_id', memberId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (sub) {
    const base = sub.end_date && new Date(sub.end_date) > today ? new Date(sub.end_date) : today;
    const end = extendDate(base, dur);
    const { error } = await supabase.from('member_subscriptions')
      .update({ end_date: iso(end), status: 'active', plan_id: planId }).eq('id', sub.id);
    if (error) throw new Error(error.message);
  } else {
    const end = extendDate(today, dur);
    const { error } = await supabase.from('member_subscriptions')
      .insert({ gym_id: gymId, member_id: memberId, plan_id: planId, start_date: iso(today), end_date: iso(end), status: 'active' });
    if (error) throw new Error(error.message);
  }
}

// The member's open visit today (WAT): checked in, not yet checked out — the
// row check-out closes. Mirrors openVisit in lib/actions/checkin.ts.
async function openVisit(supabase: SupabaseClient, gymId: string, memberId: string) {
  const { data } = await supabase.from('check_ins').select('id')
    .eq('member_id', memberId).eq('gym_id', gymId)
    .eq('status', 'active').is('checked_out_at', null)
    .gte('checked_in_at', watDayStartUtc(watDateISO()))
    .order('checked_in_at', { ascending: false })
    .limit(1).maybeSingle();
  return data;
}

// Close an open visit: stamp checked_out_at, flip status to 'completed'. The
// used_at-style IS NULL guard makes a concurrent double check-out a no-op.
async function closeVisit(supabase: SupabaseClient, visitId: string) {
  const { error } = await supabase.from('check_ins')
    .update({ checked_out_at: new Date().toISOString(), status: 'completed' })
    .eq('id', visitId).is('checked_out_at', null);
  if (error) throw new Error(error.message);
}

export async function manualCheckIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '');
  try {
    const { gymId, supabase, isActive } = await ctx(memberId);
    if (!isActive) return { ok: false, error: 'This member is suspended. Reactivate them before checking in.' };
    // De-dupe while the member is inside so a self + front-desk check-in (or a
    // double tap) doesn't inflate visit counts — mirrors selfCheckIn. A visit
    // closed by check-out earlier today doesn't block re-entry.
    const already = await openVisit(supabase, gymId, memberId);
    if (already) {
      revalidatePath(`/admin/members/${memberId}`);
      revalidatePath('/admin/staff-checkin');
      return { ok: true, error: null, message: 'Already checked in.' };
    }
    const { error } = await supabase.from('check_ins').insert({
      gym_id: gymId, member_id: memberId,
      checked_in_at: new Date().toISOString(), status: 'active', check_in_method: 'front_desk',
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/admin/members/${memberId}`);
    revalidatePath('/admin/staff-checkin');
    return { ok: true, error: null, message: 'Checked in.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function manualCheckOut(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '');
  try {
    const { gymId, supabase } = await ctx(memberId);
    const open = await openVisit(supabase, gymId, memberId);
    if (!open) return { ok: false, error: 'Not checked in right now.' };
    await closeVisit(supabase, open.id);
    revalidatePath(`/admin/members/${memberId}`);
    revalidatePath('/admin/staff-checkin');
    return { ok: true, error: null, message: 'Checked out.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Redeem a front-desk code the member generated on their check-in page (see
// generateCheckinCode in lib/actions/checkin.ts): checks the member in, or out
// if they're already inside. Codes are single-use — burning one is an UPDATE
// guarded by used_at IS NULL, so of two concurrent redeems exactly one wins.
export async function redeemCheckinCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = String(formData.get('code') ?? '').replace(/\D/g, '');
  if (code.length !== 6) return { ok: false, error: 'Enter the 6-digit code.' };
  try {
    const { gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    const nowIso = new Date().toISOString();

    const { data: match } = await supabase.from('checkin_codes')
      .select('id, member_id')
      .eq('gym_id', gym.id).eq('code', code)
      .is('used_at', null).gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (!match) return { ok: false, error: 'Invalid or expired code. Ask the member for a fresh one.' };

    const { data: burned } = await supabase.from('checkin_codes')
      .update({ used_at: nowIso }).eq('id', match.id).is('used_at', null).select('id');
    if (!burned?.length) return { ok: false, error: 'That code was just used. Ask the member for a fresh one.' };

    const memberId = match.member_id;
    const [{ data: profile }, { data: link }] = await Promise.all([
      supabase.from('profiles').select('full_name, email').eq('id', memberId).maybeSingle(),
      supabase.from('gym_member_links').select('is_active').eq('gym_id', gym.id)
        .or(`member_id.eq.${memberId},user_id.eq.${memberId}`).maybeSingle(),
    ]);
    const name = profile?.full_name ?? profile?.email ?? 'Member';

    const open = await openVisit(supabase, gym.id, memberId);
    if (open) {
      await closeVisit(supabase, open.id);
      revalidatePath('/admin/staff-checkin');
      revalidatePath(`/admin/members/${memberId}`);
      return { ok: true, error: null, message: `${name} checked out.` };
    }

    if (link && link.is_active === false) {
      return { ok: false, error: `${name} is suspended. Reactivate them before checking in.` };
    }
    const { error } = await supabase.from('check_ins').insert({
      gym_id: gym.id, member_id: memberId,
      checked_in_at: nowIso, status: 'active', check_in_method: 'code',
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath('/admin/staff-checkin');
    revalidatePath(`/admin/members/${memberId}`);
    return { ok: true, error: null, message: `${name} checked in.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  const method = String(formData.get('method') ?? 'cash');
  const planId = String(formData.get('planId') ?? '') || null;
  const extend = formData.get('extend') === 'on';
  if (!amount || amount <= 0) return { ok: false, error: 'Enter a valid amount.' };
  if (!PAYMENT_METHODS.has(method)) return { ok: false, error: 'Invalid payment method.' };
  try {
    const { gymId, supabase, actorId } = await ctx(memberId);
    const { error } = await supabase.from('payments').insert({
      gym_id: gymId, member_id: memberId, plan_id: planId, amount, currency: 'NGN',
      payment_method: method, status: 'success', payment_status: 'successful',
      payment_date: new Date().toISOString(), paystack_reference: `MANUAL-${Date.now()}-${(globalThis.crypto as Crypto).randomUUID()}`,
    });
    if (error) return { ok: false, error: error.message };
    if (extend && planId) await extendSubscription(supabase, gymId, memberId, planId);
    const { error: nErr } = await supabase.from('notifications').insert({
      gym_id: gymId, user_id: memberId, type: 'payment', channel: 'in_app',
      title: 'Payment received', body: `₦${amount.toLocaleString('en-NG')} payment recorded. Thank you!`,
    });
    if (nErr) console.warn(`[recordPayment] notification failed: ${nErr.message}`); // payment itself recorded
    logAudit({ action: 'payment_recorded', table: 'payments', actorId: actorId, gymId, recordId: memberId, values: { amount, method, planId, extend } });
    revalidatePath(`/admin/members/${memberId}`);
    return { ok: true, error: null, message: extend && planId ? 'Payment recorded and membership extended.' : 'Payment recorded.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function renewMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '');
  const planId = String(formData.get('planId') ?? '');
  if (!planId) return { ok: false, error: 'Choose a plan.' };
  try {
    const { gymId, supabase, actorId } = await ctx(memberId);
    await extendSubscription(supabase, gymId, memberId, planId);
    logAudit({ action: 'membership_renewed', table: 'member_subscriptions', actorId, gymId, recordId: memberId, values: { planId } });
    revalidatePath(`/admin/members/${memberId}`);
    return { ok: true, error: null, message: 'Membership renewed.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setMemberActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '');
  const active = formData.get('active') === 'true';
  try {
    const { gymId, supabase, actorId } = await ctx(memberId);
    const { error } = await supabase.from('gym_member_links')
      .update({ is_active: active })
      .eq('gym_id', gymId)
      .or(`member_id.eq.${memberId},user_id.eq.${memberId}`);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: active ? 'member_reactivated' : 'member_suspended', table: 'gym_member_links', actorId, gymId, recordId: memberId });
    revalidatePath(`/admin/members/${memberId}`);
    return { ok: true, error: null, message: active ? 'Member reactivated.' : 'Member suspended.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Create a managed member (no login account) for the staff's gym, optionally
// starting a membership. profiles.id isn't tied to auth.users, so we mint one.
export async function addMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const fullName = String(formData.get('full_name') ?? '').trim().slice(0, 120);
  const email = String(formData.get('email') ?? '').trim().slice(0, 254) || null;
  const phone = String(formData.get('phone') ?? '').trim().slice(0, 32) || null;
  const planId = String(formData.get('planId') ?? '') || null;
  if (!fullName) return { ok: false, error: 'Enter the member’s name.' };

  const newId = (globalThis.crypto as Crypto).randomUUID();
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();

    // full_name is GENERATED in the live DB — write first/last; it derives the rest.
    const { error: pErr } = await supabase.from('profiles').insert({
      id: newId, gym_id: gym.id, ...splitName(fullName), email, phone, role: 'member', is_active: true,
    });
    if (pErr) return { ok: false, error: pErr.message };

    const { error: lErr } = await supabase.from('gym_member_links').insert({
      gym_id: gym.id, member_id: newId, joined_at: new Date().toISOString(), is_active: true, onboarding_method: 'admin',
    });
    if (lErr) return { ok: false, error: lErr.message };

    if (planId) await extendSubscription(supabase, gym.id, newId, planId);
    logAudit({ action: 'member_added', table: 'profiles', actorId: user.id, gymId: gym.id, recordId: newId, values: { planId } });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect(`/admin/members/${newId}`);
}

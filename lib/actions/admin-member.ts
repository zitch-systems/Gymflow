'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { splitName } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActionState = { ok: boolean; error: string | null; message?: string };

const PAYMENT_METHODS = new Set(['card', 'bank_transfer', 'cash', 'crypto']);

// Resolve the acting staff's gym + a member-scoped client, and verify the
// target member actually belongs to this gym. RLS (staff_* policies) is the
// real authority on the writes; this is the in-app guard + scoping.
async function ctx(memberId: string) {
  const { user, gym } = await requireStaff(ADMIN_ROLES);
  const supabase = await createClient();
  const { data: link } = await supabase
    .from('gym_member_links')
    .select('id, is_active')
    .eq('gym_id', gym.id)
    .or(`member_id.eq.${memberId},user_id.eq.${memberId}`)
    .maybeSingle();
  if (!link) throw new Error('Member not found in this gym.');
  return { gymId: gym.id, supabase, actorId: user.id };
}

// Extend the member's latest subscription by the plan duration (or create one).
async function extendSubscription(supabase: SupabaseClient, gymId: string, memberId: string, planId: string) {
  const { data: plan } = await supabase.from('membership_plans').select('duration_months').eq('id', planId).maybeSingle();
  const months = Number(plan?.duration_months ?? 1) || 1;
  const { data: sub } = await supabase
    .from('member_subscriptions').select('id, end_date')
    .eq('gym_id', gymId).eq('member_id', memberId)
    .order('end_date', { ascending: false }).limit(1).maybeSingle();

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (sub) {
    const base = sub.end_date && new Date(sub.end_date) > today ? new Date(sub.end_date) : today;
    const end = new Date(base); end.setMonth(end.getMonth() + months);
    const { error } = await supabase.from('member_subscriptions')
      .update({ end_date: iso(end), status: 'active', plan_id: planId }).eq('id', sub.id);
    if (error) throw new Error(error.message);
  } else {
    const end = new Date(today); end.setMonth(end.getMonth() + months);
    const { error } = await supabase.from('member_subscriptions')
      .insert({ gym_id: gymId, member_id: memberId, plan_id: planId, start_date: iso(today), end_date: iso(end), status: 'active' });
    if (error) throw new Error(error.message);
  }
}

export async function manualCheckIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '');
  try {
    const { gymId, supabase } = await ctx(memberId);
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
      payment_date: new Date().toISOString(), paystack_reference: `MANUAL-${Date.now()}`,
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

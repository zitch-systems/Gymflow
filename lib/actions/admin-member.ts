'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { splitName, normalizeNgPhone, firstName, fmtDate } from '@/lib/format';
import { extendDate, renewalBase } from '@/lib/plan-duration';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { deliverDoorEvent } from '@/lib/notify';
import {
  MEMBER_TEMPLATES, membershipPaused, membershipResumed, receipt, welcome,
  type ReceiptMethod,
} from '@/lib/email/templates/member';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActionState = { ok: boolean; error: string | null; message?: string };

const PAYMENT_METHODS = new Set(['card', 'bank_transfer', 'cash', 'crypto']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// payments.payment_method → the spelling the receipt template prints. 'crypto'
// is the one front-desk option the template has no word for; 'transfer' is the
// closest true statement (the member moved funds, they didn't present a card)
// and a receipt with a coarse method beats no receipt for money that was paid.
const RECEIPT_METHOD: Record<string, ReceiptMethod> = {
  cash: 'cash', card: 'card', bank_transfer: 'bank_transfer', crypto: 'transfer',
};

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
  // `gym` is the full row requireStaff already loaded — the member-facing mail
  // below is dressed in its logo, colour and subdomain, so handing it back here
  // saves every send site re-reading the gym it is already acting as.
  return { gymId: gym.id, gym, supabase, actorId: user.id, isActive: link.is_active !== false };
}

// The member's address + their own email opt-out. Three send sites in this file
// need exactly this, and the RESEND_API_KEY check belongs in front of the read:
// a gym with email switched off shouldn't pay for a round-trip on every payment,
// renewal and suspension just to discover that. Staff can read their own
// members' profiles under the existing RLS policy — no service role needed.
async function mailTarget(supabase: SupabaseClient, memberId: string) {
  if (!process.env.RESEND_API_KEY) return null;
  const { data } = await supabase
    .from('profiles').select('email, full_name, notification_email').eq('id', memberId).maybeSingle();
  const email = (data?.email ?? '').trim();
  if (!email) return null;
  return { email, fullName: data?.full_name ?? null, wantsEmail: data?.notification_email !== false };
}

// Name + price of a plan, scoped to this gym. Receipts quote both; the welcome
// mail quotes the name. Same gym scoping as extendSubscription — a plan_id from
// a form never gets to name another gym's plan in a member's inbox.
async function planFor(supabase: SupabaseClient, gymId: string, planId: string | null) {
  if (!planId) return null;
  const { data } = await supabase
    .from('membership_plans').select('name, price').eq('id', planId).eq('gym_id', gymId).maybeSingle();
  return data ? { name: (data.name as string | null) ?? null, price: Number(data.price ?? 0) } : null;
}

// Extend the member's latest subscription by the plan duration (or create one).
// Returns the new end date (YYYY-MM-DD): the member-facing mail these callers
// send has to state what the member actually bought, and re-reading the row to
// find out invites a race with a concurrent renewal.
async function extendSubscription(supabase: SupabaseClient, gymId: string, memberId: string, planId: string): Promise<string> {
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
    // Stack onto the current period when it's still running — see renewalBase().
    const base = renewalBase(sub.end_date, today);
    const end = extendDate(base, dur);
    const { error } = await supabase.from('member_subscriptions')
      .update({ end_date: iso(end), status: 'active', plan_id: planId }).eq('id', sub.id);
    if (error) throw new Error(error.message);
    return iso(end);
  }
  const end = extendDate(today, dur);
  const { error } = await supabase.from('member_subscriptions')
    .insert({ gym_id: gymId, member_id: memberId, plan_id: planId, start_date: iso(today), end_date: iso(end), status: 'active' });
  if (error) throw new Error(error.message);
  return iso(end);
}

// True when the member has an active subscription that hasn't expired today
// (WAT). Mirrors the gate in selfCheckIn (lib/actions/checkin.ts) so a lapsed
// membership can't sneak in through the front-desk code or manual check-in.
async function hasActiveSub(supabase: SupabaseClient, gymId: string, memberId: string) {
  const { data: sub } = await supabase
    .from('member_subscriptions').select('end_date')
    .eq('gym_id', gymId).eq('member_id', memberId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  return Boolean(sub && (sub.end_date ?? '') >= watDateISO());
}

// Days left on the active subscription, for the WhatsApp check-in confirmation.
// Null when there is no active subscription — the message then just says the
// membership is active rather than inventing a number.
async function daysLeftFor(supabase: SupabaseClient, gymId: string, memberId: string): Promise<number | null> {
  const { data: sub } = await supabase
    .from('member_subscriptions').select('end_date')
    .eq('gym_id', gymId).eq('member_id', memberId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  const end = (sub as { end_date: string | null } | null)?.end_date ?? null;
  if (!end) return null;
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000));
}

// How long an open visit has been running, in whole minutes.
function minutesSince(startedAt: string | null | undefined): number | null {
  if (!startedAt) return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : null;
}

// The member's open visit today (WAT): checked in, not yet checked out — the
// row check-out closes. Mirrors openVisit in lib/actions/checkin.ts.
async function openVisit(supabase: SupabaseClient, gymId: string, memberId: string) {
  // checked_in_at rides along so check-out can tell the member how long they
  // trained — the WhatsApp confirmation quotes it.
  const { data } = await supabase.from('check_ins').select('id, checked_in_at')
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
    if (!(await hasActiveSub(supabase, gymId, memberId))) {
      return { ok: false, error: 'Membership isn’t active. Renew before checking in.' };
    }
    const { error } = await supabase.from('check_ins').insert({
      gym_id: gymId, member_id: memberId,
      checked_in_at: new Date().toISOString(), status: 'active', check_in_method: 'front_desk',
    });
    if (error) return { ok: false, error: error.message };
    // The member's own confirmation. Staff see the result on this screen; until
    // now the person it happened to saw nothing.
    deliverDoorEvent({ memberId, gymId, action: 'checked_in', daysLeft: await daysLeftFor(supabase, gymId, memberId) });
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
    deliverDoorEvent({ memberId, gymId, action: 'checked_out', sessionMinutes: minutesSince(open.checked_in_at) });
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
      deliverDoorEvent({ memberId, gymId: gym.id, action: 'checked_out', sessionMinutes: minutesSince(open.checked_in_at) });
      revalidatePath('/admin/staff-checkin');
      revalidatePath(`/admin/members/${memberId}`);
      return { ok: true, error: null, message: `${name} checked out.` };
    }

    if (link && link.is_active === false) {
      return { ok: false, error: `${name} is suspended. Reactivate them before checking in.` };
    }
    if (!(await hasActiveSub(supabase, gym.id, memberId))) {
      return { ok: false, error: `${name}’s membership isn’t active. Renew before checking in.` };
    }
    const { error } = await supabase.from('check_ins').insert({
      gym_id: gym.id, member_id: memberId,
      checked_in_at: nowIso, status: 'active', check_in_method: 'code',
    });
    if (error) return { ok: false, error: error.message };
    // This is the path the member asked for by reading out a code, so the
    // confirmation closes the loop they opened in the WhatsApp thread.
    deliverDoorEvent({ memberId, gymId: gym.id, action: 'checked_in', daysLeft: await daysLeftFor(supabase, gym.id, memberId) });
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
    const { gymId, gym, supabase, actorId } = await ctx(memberId);
    const { error } = await supabase.from('payments').insert({
      gym_id: gymId, member_id: memberId, plan_id: planId, amount, currency: 'NGN',
      payment_method: method, status: 'success', payment_status: 'successful',
      payment_date: new Date().toISOString(), paystack_reference: `MANUAL-${Date.now()}-${(globalThis.crypto as Crypto).randomUUID()}`,
    });
    if (error) return { ok: false, error: error.message };
    const newEnd = extend && planId ? await extendSubscription(supabase, gymId, memberId, planId) : null;
    const { error: nErr } = await supabase.from('notifications').insert({
      gym_id: gymId, user_id: memberId, type: 'payment', channel: 'in_app',
      title: 'Payment received', body: `₦${amount.toLocaleString('en-NG')} payment recorded. Thank you!`,
    });
    if (nErr) console.warn(`[recordPayment] notification failed: ${nErr.message}`); // payment itself recorded
    logAudit({ action: 'payment_recorded', table: 'payments', actorId: actorId, gymId, recordId: memberId, values: { amount, method, planId, extend } });

    // Cash and bank transfer are how most Nigerian gyms actually get paid, and
    // until now those payments left the member with nothing at all — every
    // emailed receipt on the platform came from a Paystack charge. Best-effort:
    // the money is already recorded and a mail failure must not undo it.
    try {
      const to = await mailTarget(supabase, memberId);
      if (to) {
        const plan = await planFor(supabase, gymId, planId);
        const spec = MEMBER_TEMPLATES.receipt;
        await sendGymEmail({
          gym, to, template: spec.template, category: spec.category,
          ...receipt({
            gymName: gym.name,
            firstName: firstName(to.fullName),
            amountNaira: amount,
            method: RECEIPT_METHOD[method] ?? 'cash',
            planName: plan?.name ?? null,
            // Dated from the WAT calendar day, not the UTC server one: a payment
            // taken at 00:30 in Lagos is not yesterday's on the member's receipt.
            paidOn: fmtDate(watDateISO()),
            endDate: newEnd ? fmtDate(newEnd) : null,
            // paystack_reference here is an internal idempotency key
            // (MANUAL-<epoch>-<uuid>) — nobody reads that off a receipt, and the
            // amount and date are what identify the payment at the desk.
            reference: null,
            dashboardUrl: memberAppUrl(gym),
          }),
        });
      }
    } catch { /* receipt is a bonus channel — never fails the payment */ }

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
    const { gymId, gym, supabase, actorId } = await ctx(memberId);
    const newEnd = await extendSubscription(supabase, gymId, memberId, planId);
    logAudit({ action: 'membership_renewed', table: 'member_subscriptions', actorId, gymId, recordId: memberId, values: { planId } });

    // A front-desk renewal: staff picked a priced plan and confirmed it, which
    // in this market means the member handed over the money at the counter. The
    // receipt states the plan price and — the part they actually want — the date
    // their membership now runs to. Method is the desk default: staff who took a
    // card or a transfer record it through Record payment, which carries the
    // real one. Best-effort; the membership is already extended.
    try {
      const to = await mailTarget(supabase, memberId);
      if (to) {
        const plan = await planFor(supabase, gymId, planId);
        const spec = MEMBER_TEMPLATES.receipt;
        await sendGymEmail({
          gym, to, template: spec.template, category: spec.category,
          ...receipt({
            gymName: gym.name,
            firstName: firstName(to.fullName),
            amountNaira: plan?.price ?? 0,
            method: 'cash',
            planName: plan?.name ?? null,
            paidOn: fmtDate(watDateISO()),
            endDate: fmtDate(newEnd),
            dashboardUrl: memberAppUrl(gym),
          }),
        });
      }
    } catch { /* receipt is a bonus channel — never fails the renewal */ }

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
    const { gymId, gym, supabase, actorId } = await ctx(memberId);
    const { error } = await supabase.from('gym_member_links')
      .update({ is_active: active })
      .eq('gym_id', gymId)
      .or(`member_id.eq.${memberId},user_id.eq.${memberId}`);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: active ? 'member_reactivated' : 'member_suspended', table: 'gym_member_links', actorId, gymId, recordId: memberId });

    // Suspension is invisible from the member's side until they're turned away
    // at the door, so it's the one membership state change that has to leave the
    // building. Category 'updates' — a gym that finds the renewal nudges pushy
    // can switch those off without also muting "your card stopped working".
    try {
      const to = await mailTarget(supabase, memberId);
      if (to) {
        const spec = active ? MEMBER_TEMPLATES.membershipResumed : MEMBER_TEMPLATES.membershipPaused;
        // Only the reactivation quotes an end date ("you're covered to…"), so
        // only that branch pays for the read.
        const { data: sub } = active
          ? await supabase
            .from('member_subscriptions').select('end_date')
            .eq('gym_id', gymId).eq('member_id', memberId).eq('status', 'active')
            .order('end_date', { ascending: false }).limit(1).maybeSingle()
          : { data: null };
        const content = active
          ? membershipResumed({
            gymName: gym.name,
            firstName: firstName(to.fullName),
            classesUrl: memberAppUrl(gym, '/classes'),
            endDate: sub?.end_date ? fmtDate(sub.end_date) : null,
          })
          : membershipPaused({
            gymName: gym.name,
            firstName: firstName(to.fullName),
            dashboardUrl: memberAppUrl(gym),
            pausedOn: fmtDate(watDateISO()),
          });
        await sendGymEmail({ gym, to, template: spec.template, category: spec.category, ...content });
      }
    } catch { /* bonus channel — the member is already suspended/reactivated */ }

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
  const phone = normalizeNgPhone(String(formData.get('phone') ?? ''));
  const planId = String(formData.get('planId') ?? '') || null;
  if (!fullName) return { ok: false, error: 'Enter the member’s name.' };
  if (!phone) return { ok: false, error: 'Enter a valid phone number (e.g. 080 1234 5678).' };

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

    const newEnd = planId ? await extendSubscription(supabase, gym.id, newId, planId) : null;
    logAudit({ action: 'member_added', table: 'profiles', actorId: user.id, gymId: gym.id, recordId: newId, values: { planId } });

    // Email is the ONLY channel that reaches a managed member. Their profiles.id
    // is a UUID we minted above, not an auth.users id, so there is no account to
    // sign in to and no in-app notifications row that anyone could ever read —
    // notifications.user_id would point at a user that doesn't exist. Which also
    // means no set-password link: there's no account to set a password on.
    // Best-effort, and last: the member exists either way.
    try {
      if (email && process.env.RESEND_API_KEY) {
        const plan = planId ? await planFor(supabase, gym.id, planId) : null;
        const spec = MEMBER_TEMPLATES.welcome;
        await sendGymEmail({
          gym,
          // notification_email defaults true on the row just inserted, so there
          // is nothing to look up — and welcome is 'critical' regardless.
          to: { email, fullName },
          template: spec.template,
          category: spec.category,
          ...welcome({
            gymName: gym.name,
            firstName: firstName(fullName),
            dashboardUrl: memberAppUrl(gym),
            memberCode: gym.member_code,
            planName: plan?.name ?? null,
            endDate: newEnd ? fmtDate(newEnd) : null,
          }),
        });
      }
    } catch { /* bonus channel — the member is already created */ }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect(`/admin/members/${newId}`);
}

// Assign (or clear) the private trainer a member paid for.
//
// The add-on is sold at checkout without naming a person — the gym matches them
// afterwards, which is this action. The pairing lands in instructor_subscriptions,
// the table that already models member ↔ instructor and feeds the coach's client
// list, earnings and payouts; nothing new is invented to hold it.
//
// Writes go through the service-role client because instructor_subscriptions is
// deliberately service-role-only (20260801120000_lock_instructor_subscriptions_writes.sql):
// an instructor who could INSERT their own row could inflate the earnings sum
// that pays them. Staff authorization is enforced here instead, by ctx().
export async function assignTrainer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get('memberId') ?? '');
  const instructorId = String(formData.get('instructorId') ?? '');
  // Empty is a real choice: it un-assigns, for a member matched to the wrong
  // coach or one whose coach has left.
  const clearing = instructorId === '';
  if (!clearing && !UUID_RE.test(instructorId)) return { ok: false, error: 'Choose a trainer.' };
  try {
    const { gymId, supabase, actorId } = await ctx(memberId);

    // The subscription the trainer time was bought on. It carries the period the
    // pairing should cover, and its trainer_addon flag is the receipt that the
    // member paid for a trainer at all.
    const { data: sub } = await supabase
      .from('member_subscriptions')
      .select('id, start_date, end_date, trainer_addon')
      .eq('gym_id', gymId).eq('member_id', memberId)
      .order('end_date', { ascending: false }).limit(1).maybeSingle();
    if (!sub?.trainer_addon) {
      return { ok: false, error: 'This member hasn’t paid for the private trainer add-on.' };
    }

    // Instructors only, active only. A member matched to a coach who no longer
    // works here is worse than an unmatched one: it looks handled.
    if (!clearing) {
      const { data: staff } = await supabase.from('gym_staff_links')
        .select('user_id').eq('gym_id', gymId).eq('user_id', instructorId)
        .eq('role', 'instructor').eq('is_active', true).maybeSingle();
      if (!staff) return { ok: false, error: 'That trainer isn’t an active instructor at this gym.' };
    }

    let admin: SupabaseClient;
    try { admin = createAdminClient() as unknown as SupabaseClient; } catch {
      return { ok: false, error: 'Trainer assignment needs the service-role key to be configured.' };
    }

    // One live pairing per member per gym. Retiring the old one before writing
    // the new keeps a re-assignment from paying two coaches for one member.
    const { error: clearErr } = await admin.from('instructor_subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('gym_id', gymId).eq('member_id', memberId).eq('status', 'active');
    if (clearErr) return { ok: false, error: clearErr.message };

    if (!clearing) {
      const { error: insErr } = await admin.from('instructor_subscriptions').insert({
        gym_id: gymId, instructor_id: instructorId, member_id: memberId,
        status: 'active', start_date: sub.start_date, end_date: sub.end_date,
        // amount_paid drives the coach's payout balance, and this action moves
        // no money — the member already paid the gym at checkout. Leave it at 0
        // and let the gym settle with the coach through the payout queue.
        amount_paid: 0,
      });
      if (insErr) return { ok: false, error: insErr.message };
    }

    logAudit({
      action: clearing ? 'member_trainer_unassigned' : 'member_trainer_assigned',
      table: 'instructor_subscriptions',
      actorId, gymId, recordId: memberId,
      values: { instructor_id: clearing ? null : instructorId, member_subscription_id: sub.id },
    });

    revalidatePath(`/admin/members/${memberId}`);
    return { ok: true, error: null, message: clearing ? 'Trainer unassigned.' : 'Trainer assigned.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

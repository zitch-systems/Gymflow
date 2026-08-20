'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { isOfflineGym } from '@/lib/gym-status';
import { gymCanUse, memberLockedMessage } from '@/lib/entitlements';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestOrigin } from '@/lib/request-origin';
import { initSubscription, createPlan, planIntervalFor, getSubscription, disableSubscription } from '@/lib/paystack';
import { logAudit } from '@/lib/audit';
import { LIVE_SUB_STATUSES, hasLiveMandate, mandateGoneAtPaystack } from '@/lib/member-sub-core';
import { offersTrainer, planTotalKobo } from '@/lib/plan-addon';
import { firstName, fmtDate } from '@/lib/format';
import { getContact, getEmailGym } from '@/lib/email/recipients';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { MEMBER_TEMPLATES, autoRenewDisabled } from '@/lib/email/templates/member';

// Member auto-recurring billing. Mirrors the platform-billing pattern for
// members: opt-in creates a Paystack Subscription (lazy-creating the Plan on
// first use per membership plan), cancel disables it at Paystack.
//
// Two entry points for cancel: self-serve (member turns their own off) and
// staff override (admin turns it off for a member). Both funnel through the
// same disable + audit-log path so the outcomes are identical.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StartResult = { ok: true; url: string } | { ok: false; error: string };
export type ActionState = { ok: boolean; error: string | null; message?: string };

// Get or lazy-create the Paystack Plan code for a membership_plans row. Cached
// on the row so subsequent opt-ins reuse it. Uses the admin client so the
// UPDATE isn't blocked by RLS (membership_plans staff-write policy exists but
// we want member auto-billing to work even when the member is the one
// triggering creation).
// Returns the amount alongside the code: initSubscription has to send one
// (Paystack requires it even with a plan code), and the membership_plans row
// read here is where the price already is.
//
// A Paystack Plan fixes ONE recurring amount, so plan-with-trainer needs its
// own Plan object and its own cached code (paystack_plan_code_trainer).
// Reusing the base code for a member who took the add-on would charge them the
// plan price alone on every cycle after the first — the gym would hand out
// trainer time it stopped being paid for, silently.
async function ensurePlanCode(
  planId: string,
  gymId: string,
  withTrainer: boolean,
): Promise<{ ok: true; code: string; amountKobo: number; trainerAddon: boolean } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: plan, error } = await admin
    .from('membership_plans')
    .select('id, gym_id, name, price, duration_days, duration_months, paystack_plan_code, paystack_plan_code_trainer, trainer_addon_enabled, trainer_addon_price')
    .eq('id', planId).eq('gym_id', gymId).eq('is_active', true)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!plan) return { ok: false, error: 'Plan not found.' };

  // The plan row, not the caller, decides whether the add-on applies.
  const trainerAddon = withTrainer && offersTrainer(plan);
  const amountKobo = planTotalKobo(plan, trainerAddon);
  const cached = trainerAddon ? plan.paystack_plan_code_trainer : plan.paystack_plan_code;
  if (cached) return { ok: true, code: cached, amountKobo, trainerAddon };

  const interval = planIntervalFor(plan.duration_days ?? null, plan.duration_months ?? null);
  if (!interval) return { ok: false, error: `Plan "${plan.name}" duration doesn't map to a Paystack billing interval.` };

  const res = await createPlan({
    name: trainerAddon ? `${plan.name} + private trainer (auto-renew)` : `${plan.name} (auto-renew)`,
    amountKobo,
    interval,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // Cache. If two callers race, second write is a no-op (both share the same
  // eventual code) — Paystack will just have two Plan objects with the same
  // config, harmless.
  await admin.from('membership_plans')
    .update(trainerAddon ? { paystack_plan_code_trainer: res.planCode } : { paystack_plan_code: res.planCode })
    .eq('id', plan.id);
  return { ok: true, code: res.planCode, amountKobo, trainerAddon };
}

// Start an auto-renewing subscription for the signed-in member. Same shape as
// startRenewal in renew.ts (returns the Paystack authorization URL to redirect
// to), but wires Paystack Subscriptions so future charges recur automatically.
// The webhook (lib/member-sub-fulfill.ts) records renewals and tracks state.
export async function startAutoRenewal(planId: string, withTrainer = false): Promise<StartResult> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Payments are not configured yet (missing PAYSTACK_SECRET_KEY).' };
  }
  const { user, gym } = await requireMember();
  // See the same guard in renew.ts. This one matters more, not less: a
  // subscription keeps charging on a schedule, so one that slips through
  // outlives the checkout by months.
  if (isOfflineGym(gym)) {
    return { ok: false, error: 'This gym is not accepting payments right now. Please contact the gym.' };
  }
  // And the same reasoning for the plan gate as in renew.ts, doubled for the
  // same reason as the line above: a mandate this action opens keeps charging
  // on a schedule long after the surface that opened it was walled off.
  if (!gymCanUse(gym, 'member_app')) {
    return { ok: false, error: memberLockedMessage(gym.name, 'the member app') };
  }

  // One mandate per member. A member who already has auto-renew on — on this
  // plan or another one — would otherwise get a SECOND live Paystack
  // Subscription against the same card, and the fulfiller refuses that
  // mandate's charges permanently (`subscription code conflicts with active
  // mandate`, lib/member-sub-fulfill.ts). Every cycle after that debits the
  // card, records no payment, extends nothing and sends no receipt; the
  // webhook still acks 200, so Paystack keeps charging. Refusing here is the
  // only place that stops it, because by the time the charge lands the money
  // has already left. Service role: the member CAN read their own rows, but a
  // guard this consequential must not be one RLS edit away from silently
  // passing.
  const admin = createAdminClient();
  const { data: liveSubs, error: liveErr } = await admin
    .from('member_subscriptions')
    .select('auto_debit_enabled')
    .eq('member_id', user.id).eq('gym_id', gym.id)
    .in('status', [...LIVE_SUB_STATUSES]);
  if (liveErr) return { ok: false, error: liveErr.message };
  if (hasLiveMandate(liveSubs)) {
    return { ok: false, error: 'Auto-renew is already on for your membership. Turn it off first, then switch it on for the plan you want.' };
  }

  const codeResult = await ensurePlanCode(planId, gym.id, withTrainer);
  if (!codeResult.ok) return { ok: false, error: codeResult.error };

  // Same host the member started on — see lib/request-origin.ts.
  const site = await requestOrigin();
  const res = await initSubscription({
    email: user.email ?? '',
    planCode: codeResult.code,
    amountKobo: codeResult.amountKobo,
    metadata: {
      kind: 'member_subscription', gym_id: gym.id, member_id: user.id, plan_id: planId,
      // Recorded on the subscription by the fulfiller so the gym can see who is
      // owed trainer time. Recurring cycles drop metadata, but the mandate is
      // bound to the with-trainer Paystack Plan, so the flag stays true for the
      // life of the subscription.
      trainer_addon: codeResult.trainerAddon,
    },
    callbackUrl: site ? `${site}/dashboard/renew/callback` : undefined,
  });
  return res.ok ? { ok: true, url: res.authorization_url } : { ok: false, error: res.error };
}

/**
 * Tell the member their standing card mandate has ended.
 *
 * `byStaff` decides the whole shape of the message, which is why it's threaded
 * down from the two entry points rather than guessed here: a member who pressed
 * the button needs a confirmation, and a member who DIDN'T needs a notice —
 * otherwise the first they hear of it is a charge that never happened and a
 * membership that quietly lapsed.
 *
 * Reuses the caller's service-role client (the member can't read their gym's
 * branding row, and staff can't read the member's notification_email). Swallows
 * everything: Paystack has already stopped billing by this point, and a mail
 * failure must not report a completed cancellation as an error.
 */
async function mailAutoRenewOff(
  admin: ReturnType<typeof createAdminClient>,
  sub: { gymId: string; memberId: string; endDate: string | null; planId: string | null },
  byStaff: boolean,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const [gym, contact] = await Promise.all([
      getEmailGym(admin, sub.gymId),
      getContact(admin, sub.memberId),
    ]);
    if (!gym || !contact?.email) return;
    const { data: plan } = sub.planId
      ? await admin.from('membership_plans').select('name').eq('id', sub.planId).maybeSingle()
      : { data: null };
    const spec = MEMBER_TEMPLATES.autoRenewDisabled;
    await sendGymEmail({
      gym,
      to: { email: contact.email, fullName: contact.fullName, wantsEmail: contact.wantsEmail },
      template: spec.template,
      category: spec.category,
      ...autoRenewDisabled({
        gymName: (gym.name ?? '').trim() || 'Your gym',
        firstName: firstName(contact.fullName),
        byStaff,
        endDate: sub.endDate ? fmtDate(sub.endDate) : null,
        renewUrl: memberAppUrl(gym, '/dashboard/renew'),
        planName: plan?.name ?? null,
      }),
    });
  } catch { /* bonus channel */ }
}

// Shared disable path. Loads the sub via admin client (member and staff both
// need to be able to cancel), verifies gym-scoping against the caller's gym,
// hits Paystack /subscription/disable, then reflects locally.
async function disableSub(
  subId: string,
  actor: { userId: string; gymId: string; role: 'member' | 'staff' },
): Promise<ActionState> {
  if (!process.env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'Billing is not configured.' };

  const admin = createAdminClient();
  // end_date and plan_id come along for the notice below: "no more automatic
  // charges" is only actionable next to the date the paid-for access runs out.
  const { data: sub } = await admin
    .from('member_subscriptions')
    .select('id, gym_id, member_id, end_date, plan_id, paystack_subscription_code, paystack_email_token, auto_debit_enabled')
    .eq('id', subId)
    .maybeSingle();
  if (!sub) return { ok: false, error: 'Subscription not found.' };
  if (sub.gym_id !== actor.gymId) return { ok: false, error: 'Subscription not found in this gym.' };
  if (actor.role === 'member' && sub.member_id !== actor.userId) {
    return { ok: false, error: 'You can only cancel your own subscription.' };
  }
  if (!sub.paystack_subscription_code) {
    // Nothing to cancel at Paystack, but still flip the local flag so the UI
    // stops advertising auto-renew.
    await admin.from('member_subscriptions').update({ auto_debit_enabled: false }).eq('id', sub.id);
    return { ok: true, error: null, message: 'Auto-renew was already off.' };
  }

  // Paystack has nothing to disable under this code (4xx — see
  // mandateGoneAtPaystack). Clear the local flag rather than refusing: leaving
  // it true would trap the member between a cancel that can never succeed and
  // an opt-in that refuses while any live row carries a mandate, with no way
  // back to auto-renew at this gym. The caveat is said out loud because we
  // could not get Paystack to confirm it.
  const clearLocally = async (reason?: string): Promise<ActionState> => {
    await admin.from('member_subscriptions').update({ auto_debit_enabled: false }).eq('id', sub.id);
    void logAudit({
      action: actor.role === 'member' ? 'member_auto_renew_cancelled_self' : 'member_auto_renew_cancelled_by_staff',
      table: 'member_subscriptions',
      actorId: actor.userId, gymId: sub.gym_id, recordId: sub.id,
      values: { member_id: sub.member_id, paystack_subscription_code: sub.paystack_subscription_code, paystack_error: reason ?? null },
    });
    return {
      ok: true, error: null,
      message: `Auto-renew turned off. Paystack no longer has this subscription (${reason ?? 'not found'}), so tell the gym if another charge lands.`,
    };
  };

  // Paystack needs the email_token — cached from the subscription.create webhook
  // when possible; refetch if missing (older rows).
  let emailToken = sub.paystack_email_token;
  if (!emailToken) {
    const fetched = await getSubscription(sub.paystack_subscription_code);
    if (!fetched.ok) {
      return mandateGoneAtPaystack(fetched) ? clearLocally(fetched.error) : { ok: false, error: fetched.error };
    }
    emailToken = fetched.data.emailToken;
  }

  const disabled = await disableSubscription(sub.paystack_subscription_code, emailToken);
  if (!disabled.ok) {
    return mandateGoneAtPaystack(disabled)
      ? clearLocally(disabled.error)
      : { ok: false, error: disabled.error ?? 'Could not cancel at Paystack.' };
  }

  await admin.from('member_subscriptions')
    .update({ auto_debit_enabled: false })
    .eq('id', sub.id);

  void logAudit({
    action: actor.role === 'member' ? 'member_auto_renew_cancelled_self' : 'member_auto_renew_cancelled_by_staff',
    table: 'member_subscriptions',
    actorId: actor.userId, gymId: sub.gym_id, recordId: sub.id,
    values: { member_id: sub.member_id, paystack_subscription_code: sub.paystack_subscription_code },
  });

  await mailAutoRenewOff(
    admin,
    { gymId: sub.gym_id, memberId: sub.member_id, endDate: sub.end_date, planId: sub.plan_id },
    actor.role === 'staff',
  );

  return { ok: true, error: null, message: 'Auto-renew turned off. Access continues until the current period ends.' };
}

export async function cancelAutoRenewSelf(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireMember();
    const result = await disableSub(subId, { userId: user.id, gymId: gym.id, role: 'member' });
    if (result.ok) {
      revalidatePath('/dashboard');
      revalidatePath('/dashboard/renew');
      revalidatePath('/dashboard/profile');
    }
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function cancelAutoRenewByStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const result = await disableSub(subId, { userId: user.id, gymId: gym.id, role: 'staff' });
    if (result.ok) {
      // We don't have the member id in the form; just revalidate the members
      // index and the current gym's admin surfaces.
      const supabase = await createClient();
      const { data: sub } = await supabase.from('member_subscriptions').select('member_id').eq('id', subId).maybeSingle();
      if (sub?.member_id) revalidatePath(`/admin/members/${sub.member_id}`);
    }
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

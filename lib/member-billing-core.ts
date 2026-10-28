import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSubscription, disableSubscription } from '@/lib/paystack';
import { logAudit } from '@/lib/audit';
import { mandateGoneAtPaystack } from '@/lib/member-sub-core';
import { firstName, fmtDate } from '@/lib/format';
import { getContact, getEmailGym } from '@/lib/email/recipients';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { MEMBER_TEMPLATES, autoRenewDisabled } from '@/lib/email/templates/member';

export type BillingActionState = { ok: boolean; error: string | null; message?: string };

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
export async function disableMemberSubscription(
  subId: string,
  actor: { userId: string; gymId: string; role: 'member' | 'staff' },
): Promise<BillingActionState> {
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
    if (sub.auto_debit_enabled) return { ok: false, error: 'The provider mandate could not be identified. Contact the gym before starting a new auto-renew checkout.' };
    return { ok: true, error: null, message: 'Auto-renew was already off.' };
  }

  // Paystack has nothing to disable under this code (4xx — see
  // mandateGoneAtPaystack). Clear the local flag rather than refusing: leaving
  // it true would trap the member between a cancel that can never succeed and
  // an opt-in that refuses while any live row carries a mandate, with no way
  // back to auto-renew at this gym. The caveat is said out loud because we
  // could not get Paystack to confirm it.
  const clearLocally = async (reason?: string): Promise<BillingActionState> => {
    const { error } = await admin.from('member_subscriptions').update({ auto_debit_enabled: false }).eq('id', sub.id);
    if (error) return { ok: false, error: 'Cancellation could not be saved. Please retry; do not start another mandate yet.' };
    await admin.from('member_auto_renewal_intents' as never).update({ state: 'cancelled', updated_at: new Date().toISOString() } as never)
      .eq('gym_id',sub.gym_id).eq('member_id',sub.member_id).eq('state','fulfilled');
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

  const { error: cancelError } = await admin.from('member_subscriptions')
    .update({ auto_debit_enabled: false })
    .eq('id', sub.id);
  if (cancelError) return { ok: false, error: 'Paystack stopped the mandate, but the saved setting could not be confirmed. Retry cancellation before starting again.' };
  await admin.from('member_auto_renewal_intents' as never).update({ state: 'cancelled', updated_at: new Date().toISOString() } as never)
    .eq('gym_id',sub.gym_id).eq('member_id',sub.member_id).eq('state','fulfilled');

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


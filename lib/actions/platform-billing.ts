'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { initSubscription, getSubscription, disableSubscription } from '@/lib/paystack';
import { PLATFORM_PLANS, isPlanTier } from '@/lib/platform-plans';
import { fmtDate } from '@/lib/format';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { adminOrNull, getGymOwnerEmails } from '@/lib/email/recipients';
import { subscriptionCancelled } from '@/lib/email/templates/platform';

// Platform (gym → GymFlow) subscription management. OWNER-only: the dal treats
// 'manager' as "all but billing", so paying for GymFlow is the owner's call.
const OWNER_ROLES = ['gym_owner', 'owner'] as const;

export type StartResult = { ok: true; url: string } | { ok: false; error: string };

// Begin a Paystack Subscription checkout for the gym's GymFlow plan. Returns the
// authorization URL for the client to redirect to. Recurring billing + status
// are then driven entirely by the webhook (lib/platform-fulfill.ts).
export async function startPlatformSubscription(tier: string): Promise<StartResult> {
  if (!isPlanTier(tier)) return { ok: false, error: 'Unknown plan.' };
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, error: 'Billing is not configured yet (missing PAYSTACK_SECRET_KEY).' };
  }
  const plan = PLATFORM_PLANS[tier];
  const planCode = process.env[plan.planCodeEnv];
  if (!planCode) {
    return { ok: false, error: `Plan "${plan.name}" isn’t set up in Paystack yet (${plan.planCodeEnv}).` };
  }

  const { user, gym } = await requireStaff(OWNER_ROLES);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const res = await initSubscription({
    email: gym.email ?? user.email ?? '',
    planCode,
    // Paystack requires an amount even alongside a plan code; the plan's own
    // price is still what recurs. Catalogue value, kept in sync with the
    // Paystack Plan (lib/platform-plans.ts).
    amountKobo: plan.amountKobo,
    metadata: { kind: 'platform_subscription', gym_id: gym.id, plan: tier },
    callbackUrl: site ? `${site}/billing/callback` : undefined,
  });
  return res.ok ? { ok: true, url: res.authorization_url } : { ok: false, error: res.error };
}

// Cancel the gym's GymFlow subscription. Disables it at Paystack (stops future
// charges) and reflects 'cancelled' immediately; the subscription.disable webhook
// is the authoritative confirmation. Zero-arg form action — outcome is surfaced
// back on /admin/billing via the query string. The gym keeps access until the
// current period ends.
function backWithError(msg: string): never {
  redirect(`/admin/billing?billing_error=${encodeURIComponent(msg)}`);
}

export async function cancelPlatformSubscription(): Promise<void> {
  if (!process.env.PAYSTACK_SECRET_KEY) backWithError('Billing is not configured.');
  const { gym } = await requireStaff(OWNER_ROLES);
  const code = gym.paystack_subscription_code;
  if (!code) backWithError('No active subscription to cancel.');

  const sub = await getSubscription(code);
  if (!sub.ok) backWithError(sub.error);
  const disabled = await disableSubscription(code, sub.data.emailToken);
  if (!disabled.ok) backWithError(disabled.error ?? 'Could not cancel.');

  // Owner-verified for this gym → reflect the cancel immediately (service role,
  // since gyms billing columns are not client-writable).
  try {
    const admin = createAdminClient();
    await admin.from('gyms').update({ subscription_status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', gym.id);
  } catch { /* webhook will still flip it */ }

  // Confirmation to every owner, not just whoever clicked: cancelling reads as
  // "did I just delete my gym?", and the paid-through date is the answer. The
  // subscription.disable webhook sends the same mail, and Resend's idempotency
  // key collapses the pair into one delivery.
  if (process.env.RESEND_API_KEY) {
    try {
      const admin = adminOrNull();
      const owners = admin ? await getGymOwnerEmails(admin, gym.id) : [];
      if (owners.length) {
        await sendPlatformEmail({
          to: owners,
          ...subscriptionCancelled({
            gymName: gym.name,
            // Not computed here — the paid period is whatever the last charge
            // bought, and cancelling doesn't shorten it.
            accessEndDate: gym.subscription_current_period_end
              ? fmtDate(gym.subscription_current_period_end)
              : 'the end of your paid period',
            billingUrl: platformAppUrl('/admin/billing'),
          }),
          template: 'subscription_cancelled',
          idempotencyKey: `platform-cancelled-${code}`,
        });
      }
    } catch { /* the cancel itself stands */ }
  }

  revalidatePath('/admin/billing');
  redirect('/admin/billing?billing_cancelled=1');
}

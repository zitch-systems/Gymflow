import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { paystackFetch } from '@/lib/paystack';
import { PLATFORM_PRICING, isBillingPeriod } from '@/lib/platform-pricing';

// Daily renewal of the GymFlow subscription each gym owes the platform.
// Without this cron the gym pays once at signup and uses the product free
// forever — the original flow only set `trial_ends_at` and never acted on it.
//
// Flow per gym whose paid period ends today:
//   1. Look up the owner's saved card (set on onboarding).
//   2. charge_authorization for PLATFORM_PRICING[plan].amount.
//   3. On success: extend trial_ends_at by the plan's months, insert
//      platform_payments, keep subscription_status='active'.
//   4. On failure: set subscription_status='past_due' so the [now..now+2] retry
//      window catches it tomorrow; after the window passes a separate sweep
//      can mark the gym suspended.
//
// Authorized by CRON_SECRET. Idempotent: a 'platform_renewal:<gym>:<date>'
// reference prevents double-charging the same gym twice on the same day.

export const runtime = 'nodejs';
export const maxDuration = 60;

const DAY_MS = 86_400_000;
const CONCURRENCY = 6;
const MAX_ROWS_PER_RUN = 200;

function isoDate(d: Date) {
  return d.toISOString().split('T')[0];
}

/**
 * Deterministic per-day-per-gym reference. Same gym charged twice on the same
 * UTC day collides on the reference, so Paystack rejects the second attempt
 * AND our idempotency SELECT short-circuits before we hit Paystack at all.
 * Exported for unit testing.
 */
export function renewalReference(gymId: string, isoDay: string): string {
  return `GFP-${gymId}-${isoDay}`;
}

function assertAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const h = request.headers.get('authorization');
  if (h === `Bearer ${expected}`) return true;
  return request.headers.get('x-vercel-cron-signature') === expected;
}

type ChargeResult = {
  status: boolean;
  data?: { reference?: string; status?: string };
  message?: string;
};

export async function GET(request: Request) {
  if (!assertAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  const supabase = createAdminClient();
  const today = isoDate(new Date());
  const windowStart = isoDate(new Date(Date.now() - 2 * DAY_MS));
  const summary = { charged: 0, failed: 0, no_card: 0, no_plan: 0 };

  // Gyms whose paid period ends in [today-2 .. today]. Stays active until
  // platformSetGymStatus or this cron marks past_due.
  const { data: due } = await supabase
    .from('gyms')
    .select('id, slug, name, email, subscription_plan, trial_ends_at, subscription_status')
    .in('subscription_status', ['active', 'past_due'])
    .gte('trial_ends_at', windowStart + 'T00:00:00Z')
    .lte('trial_ends_at', today + 'T23:59:59Z')
    .limit(MAX_ROWS_PER_RUN);

  type Row = NonNullable<typeof due>[number];

  async function processOne(gym: Row): Promise<void> {
    if (!gym.email || !gym.trial_ends_at) {
      summary.no_plan++;
      return;
    }
    const billing = isBillingPeriod(gym.subscription_plan) ? gym.subscription_plan : 'monthly';
    const plan = PLATFORM_PRICING[billing];

    // Resolve the owner via gym_staff_links (gym_owner or owner). Any active
    // owner link is acceptable — there's typically one.
    const { data: ownerLink } = await supabase
      .from('gym_staff_links')
      .select('user_id')
      .eq('gym_id', gym.id)
      .eq('role', 'gym_owner')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!ownerLink?.user_id) {
      summary.no_card++;
      return;
    }

    const { data: card } = await supabase
      .from('saved_cards')
      .select('authorization_code')
      .eq('gym_id', gym.id)
      .eq('member_id', ownerLink.user_id)
      .eq('reusable', true)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!card?.authorization_code) {
      summary.no_card++;
      // Mark past_due so this surfaces in the dashboard / owner email.
      if (gym.subscription_status === 'active') {
        await supabase.from('gyms').update({ subscription_status: 'past_due', updated_at: new Date().toISOString() }).eq('id', gym.id);
      }
      return;
    }

    // Idempotency: deterministic reference so two cron runs on the same UTC
    // day can't charge the same gym twice. Paystack rejects duplicate refs.
    const reference = renewalReference(gym.id, today);

    const { data: alreadyCharged } = await supabase
      .from('platform_payments')
      .select('id')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (alreadyCharged) return;

    let result: ChargeResult;
    try {
      result = await paystackFetch<ChargeResult>('/transaction/charge_authorization', {
        method: 'POST',
        body: JSON.stringify({
          email: gym.email,
          amount: Math.round(plan.amount * 100),
          authorization_code: card.authorization_code,
          reference,
          currency: 'NGN',
          metadata: { purpose: 'platform_renewal', gym_id: gym.id, billing },
        }),
      });
    } catch (err) {
      result = { status: false, message: (err as Error).message };
    }

    if (result.status && result.data?.status === 'success') {
      const newEnd = new Date(gym.trial_ends_at);
      newEnd.setMonth(newEnd.getMonth() + plan.months);
      await supabase
        .from('gyms')
        .update({
          subscription_status: 'active',
          trial_ends_at: newEnd.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', gym.id);
      await supabase.from('platform_payments').insert({
        gym_id: gym.id,
        amount: plan.amount,
        payment_status: 'successful',
        paystack_reference: result.data.reference ?? reference,
        billing_period_start: today,
        billing_period_end: isoDate(newEnd),
      });
      summary.charged++;
    } else {
      summary.failed++;
      if (gym.subscription_status === 'active') {
        await supabase
          .from('gyms')
          .update({ subscription_status: 'past_due', updated_at: new Date().toISOString() })
          .eq('id', gym.id);
      }
      // Use a distinct reference per failed attempt (paystack_reference is
      // UNIQUE) so successive retries each leave a wallet-history row.
      await supabase.from('platform_payments').insert({
        gym_id: gym.id,
        amount: plan.amount,
        payment_status: 'failed',
        paystack_reference: reference + '-fail-' + Date.now(),
        billing_period_start: today,
        billing_period_end: today,
      });
      console.warn('[GF platform-renewals] charge failed for', gym.slug, '-', result.message ?? 'declined');
    }
  }

  const queue = (due ?? []).slice(0, MAX_ROWS_PER_RUN);
  const skipped = Math.max(0, (due?.length ?? 0) - queue.length);
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const chunk = queue.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((row) => processOne(row).catch((e) => {
      console.error('[GF platform-renewals] row failed:', (e as Error).message);
      summary.failed++;
    })));
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), processed: queue.length, skipped, ...summary });
}

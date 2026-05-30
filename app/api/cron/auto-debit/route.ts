import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { paystackFetch } from '@/lib/paystack';
import { sendAutoDebitSuccess, sendAutoDebitFailure } from '@/lib/email';
import { waAutoDebitSuccess, waAutoDebitFailure } from '@/lib/whatsapp';
import { respectsEmail, respectsWhatsapp } from '@/lib/notification-prefs';
import { reportCronCap } from '@/lib/cron-observability';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DAY_MS = 86_400_000;
// Cap per-run work so a large overdue queue can't blow maxDuration. Any row
// we skip stays in the [end_date .. end_date+2] window for the next run.
const CONCURRENCY = 8;
const MAX_ROWS_PER_RUN = 400;

function isoDate(d: Date) {
  return d.toISOString().split('T')[0];
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
  data?: { reference?: string; status?: string; amount?: number };
  message?: string;
};

export async function GET(request: Request) {
  if (!assertAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  const supabase = createAdminClient();
  const today = isoDate(new Date());
  const summary = { charged: 0, failed: 0, exhausted: 0 };

  // Retry window: charge on the expiry day and the two following days (3 attempts)
  // rather than a single exact-date match, so a missed cron run still recovers.
  const windowStart = isoDate(new Date(Date.now() - 2 * DAY_MS));
  const { data: due } = await supabase
    .from('memberships')
    .select(
      'id, member_id, gym_id, end_date, plan_id, auto_debit_enabled, gyms(slug, name), profiles:member_id(email, full_name, first_name, phone, notification_email, notification_whatsapp), membership_plans:plan_id(name, price, duration_months)',
    )
    .eq('status', 'active')
    .eq('auto_debit_enabled', true)
    .gte('end_date', windowStart)
    .lte('end_date', today);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayIso = startOfToday.toISOString();

  type Row = NonNullable<typeof due>[number];
  async function processOne(m: Row): Promise<void> {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const gym = Array.isArray(m.gyms) ? m.gyms[0] : m.gyms;
    const plan = Array.isArray(m.membership_plans) ? m.membership_plans[0] : m.membership_plans;
    if (!profile?.email || !gym?.slug || !plan) {
      summary.failed++;
      return;
    }

    const { data: cards } = await supabase
      .from('saved_cards')
      .select('authorization_code, last4, brand, is_default')
      .eq('member_id', m.member_id ?? '')
      .eq('gym_id', m.gym_id ?? '')
      .eq('reusable', true)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1);
    const card = cards?.[0];
    if (!card) {
      summary.failed++;
      return;
    }

    // Idempotency: if we already took a successful auto-debit for THIS
    // membership today, don't charge again (guards against a double cron run).
    // Scope by plan_id — without it, the guard matches any same-day card
    // charge for this member at this gym, so a member who also auto-renews a
    // PT/instructor subscription (plan_id null, charged by another cron) would
    // have their membership charge silently skipped, or vice-versa.
    const { data: alreadyCharged } = await supabase
      .from('payments')
      .select('id')
      .eq('member_id', m.member_id ?? '')
      .eq('gym_id', m.gym_id ?? '')
      .eq('plan_id', m.plan_id ?? '')
      .eq('payment_method', 'card')
      .eq('payment_status', 'successful')
      .gte('payment_date', startOfTodayIso)
      .limit(1)
      .maybeSingle();
    if (alreadyCharged) return;

    const name = profile.full_name ?? profile.first_name ?? 'Member';
    const renewUrl = `https://${gym.slug}.gymflow.ng/dashboard/renew`;

    try {
      const result = await paystackFetch<ChargeResult>('/transaction/charge_authorization', {
        method: 'POST',
        body: JSON.stringify({
          email: profile.email,
          amount: Math.round(Number(plan.price) * 100),
          authorization_code: card.authorization_code,
          currency: 'NGN',
          metadata: { gym_id: m.gym_id, plan_id: m.plan_id, source: 'auto_debit' },
        }),
      });

      if (result.data?.status === 'success') {
        const next = new Date();
        next.setMonth(next.getMonth() + Number(plan.duration_months ?? 1));
        const newEnd = isoDate(next);
        await supabase.from('memberships').update({ end_date: newEnd, updated_at: new Date().toISOString() }).eq('id', m.id);
        const { error: payErr } = await supabase.from('payments').insert({
          gym_id: m.gym_id,
          member_id: m.member_id,
          plan_id: m.plan_id,
          amount: Number(plan.price),
          currency: 'NGN',
          payment_method: 'card',
          payment_status: 'successful',
          paystack_reference: result.data.reference,
          paystack_authorization_code: card.authorization_code,
          payment_date: new Date().toISOString(),
        });
        if (payErr) console.error('[GF auto-debit] payment record insert failed:', payErr.message);
        await Promise.allSettled([
          respectsEmail(profile)
            ? sendAutoDebitSuccess(profile.email, { name, amount: Number(plan.price), endDate: newEnd })
            : Promise.resolve(),
          profile.phone && respectsWhatsapp(profile)
            ? waAutoDebitSuccess(profile.phone, { name, amount: Number(plan.price), endDate: newEnd })
            : Promise.resolve(),
        ]);
        summary.charged++;
      } else {
        throw new Error(result.message ?? 'Charge declined');
      }
    } catch (err) {
      // Notify but DO NOT touch end_date — overwriting it would both hand out a
      // free extension and pull the row out of tomorrow's retry window.
      summary.failed++;
      await Promise.allSettled([
        respectsEmail(profile)
          ? sendAutoDebitFailure(profile.email, { name, reason: (err as Error).message, attempts: 1, renewUrl })
          : Promise.resolve(),
        profile.phone && respectsWhatsapp(profile)
          ? waAutoDebitFailure(profile.phone, { name, attempts: 1, renewUrl })
          : Promise.resolve(),
      ]);
    }
  }

  const queue = (due ?? []).slice(0, MAX_ROWS_PER_RUN);
  const skipped = Math.max(0, (due?.length ?? 0) - queue.length);
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const chunk = queue.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((row) => processOne(row).catch((e) => {
      console.error('[GF auto-debit] row failed:', (e as Error).message);
      summary.failed++;
    })));
  }

  reportCronCap({ cron: 'auto-debit', processed: queue.length, skipped, extra: summary });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), processed: queue.length, skipped, ...summary });
}

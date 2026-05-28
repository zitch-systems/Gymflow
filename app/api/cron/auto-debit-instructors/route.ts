import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { paystackFetch } from '@/lib/paystack';
import { sendAutoDebitSuccess, sendAutoDebitFailure } from '@/lib/email';
import { waAutoDebitSuccess, waAutoDebitFailure } from '@/lib/whatsapp';
import { respectsEmail, respectsWhatsapp } from '@/lib/notification-prefs';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DAY_MS = 86_400_000;
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
  const windowStart = isoDate(new Date(Date.now() - 2 * DAY_MS));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const summary = { charged: 0, failed: 0, no_card: 0, no_price: 0 };

  const { data: due } = await supabase
    .from('instructor_subscriptions')
    .select(
      'id, gym_id, instructor_id, member_id, end_date, gyms(slug, name, paystack_subaccount_code), profiles:member_id(email, full_name, first_name, phone, notification_email, notification_whatsapp), instructor:instructor_id(full_name)',
    )
    .eq('status', 'active')
    .eq('auto_renew', true)
    .gte('end_date', windowStart)
    .lte('end_date', today);

  const startOfTodayIso = startOfToday.toISOString();
  type Row = NonNullable<typeof due>[number];

  async function processOne(sub: Row): Promise<void> {
    const profile = Array.isArray(sub.profiles) ? sub.profiles[0] : sub.profiles;
    const gym = Array.isArray(sub.gyms) ? sub.gyms[0] : sub.gyms;
    if (!profile?.email || !gym?.slug || !sub.member_id || !sub.end_date) return;

    const { data: pricing } = await supabase
      .from('instructor_pricing')
      .select('price')
      .eq('gym_id', sub.gym_id)
      .eq('instructor_id', sub.instructor_id)
      .eq('billing_period', 'monthly')
      .eq('is_active', true)
      .maybeSingle();
    if (!pricing?.price) {
      summary.no_price++;
      return;
    }
    const amount = Number(pricing.price);

    const { data: card } = await supabase
      .from('saved_cards')
      .select('authorization_code')
      .eq('gym_id', sub.gym_id)
      .eq('member_id', sub.member_id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!card?.authorization_code) {
      summary.no_card++;
      return;
    }

    const { data: alreadyCharged } = await supabase
      .from('payments')
      .select('id')
      .eq('member_id', sub.member_id)
      .eq('gym_id', sub.gym_id)
      .eq('payment_method', 'card')
      .eq('payment_status', 'successful')
      .gte('payment_date', startOfTodayIso)
      .limit(1)
      .maybeSingle();
    if (alreadyCharged) return;

    let result: ChargeResult;
    try {
      result = await paystackFetch<ChargeResult>('/transaction/charge_authorization', {
        method: 'POST',
        body: JSON.stringify({
          email: profile.email,
          amount: Math.round(amount * 100),
          authorization_code: card.authorization_code,
          currency: 'NGN',
          metadata: { gym_id: sub.gym_id, instructor_id: sub.instructor_id, instructor_sub_id: sub.id },
          ...(gym.paystack_subaccount_code ? { subaccount: gym.paystack_subaccount_code, bearer: 'subaccount' } : {}),
        }),
      });
    } catch (err) {
      result = { status: false, message: (err as Error).message };
    }

    const name = profile.full_name ?? profile.first_name ?? 'Member';

    if (result.status && result.data?.status === 'success') {
      const newEnd = new Date(sub.end_date);
      newEnd.setDate(newEnd.getDate() + 30);
      await supabase
        .from('instructor_subscriptions')
        .update({ end_date: isoDate(newEnd) })
        .eq('id', sub.id);

      await supabase.from('payments').insert({
        gym_id: sub.gym_id,
        member_id: sub.member_id,
        amount,
        currency: 'NGN',
        payment_method: 'card',
        payment_status: 'successful',
        paystack_reference: result.data.reference ?? null,
        paystack_authorization_code: card.authorization_code,
        payment_date: new Date().toISOString(),
      });

      await Promise.allSettled([
        respectsEmail(profile)
          ? sendAutoDebitSuccess(profile.email, { name, amount, endDate: isoDate(newEnd) })
          : Promise.resolve(),
        profile.phone && respectsWhatsapp(profile)
          ? waAutoDebitSuccess(profile.phone, { name, amount, endDate: isoDate(newEnd) })
          : Promise.resolve(),
      ]);
      summary.charged++;
    } else {
      summary.failed++;
      const renewUrl = `https://${gym.slug}.gymflow.ng/dashboard/instructors/${sub.instructor_id}`;
      await Promise.allSettled([
        respectsEmail(profile)
          ? sendAutoDebitFailure(profile.email, { name, reason: result.message ?? 'card declined', attempts: 1, renewUrl })
          : Promise.resolve(),
        profile.phone && respectsWhatsapp(profile)
          ? waAutoDebitFailure(profile.phone, { name, renewUrl, attempts: 1 })
          : Promise.resolve(),
      ]);
    }
  }

  const queue = (due ?? []).slice(0, MAX_ROWS_PER_RUN);
  const skipped = Math.max(0, (due?.length ?? 0) - queue.length);
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const chunk = queue.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((row) => processOne(row).catch((e) => {
      console.error('[GF auto-debit-instructors] row failed:', (e as Error).message);
      summary.failed++;
    })));
  }

  return NextResponse.json({ today, processed: queue.length, skipped, summary });
}

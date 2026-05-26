import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { paystackFetch } from '@/lib/paystack';
import { sendAutoDebitSuccess, sendAutoDebitFailure } from '@/lib/email';
import { waAutoDebitSuccess, waAutoDebitFailure } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DAY_MS = 86_400_000;

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
      'id, member_id, gym_id, end_date, plan_id, auto_debit_enabled, gyms(slug, name), profiles:member_id(email, full_name, first_name, phone), membership_plans:plan_id(name, price, duration_months)',
    )
    .eq('status', 'active')
    .eq('auto_debit_enabled', true)
    .gte('end_date', windowStart)
    .lte('end_date', today);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  for (const m of due ?? []) {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const gym = Array.isArray(m.gyms) ? m.gyms[0] : m.gyms;
    const plan = Array.isArray(m.membership_plans) ? m.membership_plans[0] : m.membership_plans;
    if (!profile?.email || !gym?.slug || !plan) {
      summary.failed++;
      continue;
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
      continue;
    }

    // Idempotency: if we already took a successful auto-debit for this member at
    // this gym today, don't charge again (guards against a double cron run).
    const { data: alreadyCharged } = await supabase
      .from('payments')
      .select('id')
      .eq('member_id', m.member_id ?? '')
      .eq('gym_id', m.gym_id ?? '')
      .eq('payment_method', 'card_auto')
      .eq('payment_status', 'successful')
      .gte('payment_date', startOfToday.toISOString())
      .limit(1)
      .maybeSingle();
    if (alreadyCharged) continue;

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
        await supabase.from('payments').insert({
          gym_id: m.gym_id,
          member_id: m.member_id,
          plan_id: m.plan_id,
          amount: Number(plan.price),
          currency: 'NGN',
          payment_method: 'card_auto',
          payment_status: 'successful',
          paystack_reference: result.data.reference,
          paystack_authorization_code: card.authorization_code,
          payment_date: new Date().toISOString(),
        });
        await sendAutoDebitSuccess(profile.email, { name, amount: Number(plan.price), endDate: newEnd });
        if (profile.phone) await waAutoDebitSuccess(profile.phone, { name, amount: Number(plan.price), endDate: newEnd });
        summary.charged++;
      } else {
        throw new Error(result.message ?? 'Charge declined');
      }
    } catch (err) {
      // Notify but DO NOT touch end_date — overwriting it would both hand out a
      // free extension and pull the row out of tomorrow's retry window. The
      // membership keeps its real expiry; it stays in the [expiry .. expiry+2]
      // window for up to two more daily retries, then the expiry-reminders cron
      // marks it expired once the grace window passes.
      summary.failed++;
      await sendAutoDebitFailure(profile.email, { name, reason: (err as Error).message, attempts: 1, renewUrl });
      if (profile.phone) await waAutoDebitFailure(profile.phone, { name, attempts: 1, renewUrl });
    }
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...summary });
}

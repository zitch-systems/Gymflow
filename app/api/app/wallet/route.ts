import { requireApiMember, json, corsPreflight } from '@/lib/api-app';
import { daysLeft, watDateISO } from '@/lib/format';
import { membershipDisplayState } from '@/lib/membership-display';
import { paymentAmounts, paymentStatusLabel } from '@/lib/payment-display';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

type Payment = {
  id: string; amount: number | null; refunded_amount: number | null; payment_status: string | null;
  payment_date: string | null; created_at: string | null;
  payment_method: string | null; plan_id: string | null;
};

// GET /api/app/wallet — payment history, saved cards and the six-month spend
// bars, mirroring the web wallet page. `amount` is net spend; immutable gross
// and refunded amounts are returned alongside it so clients can explain both.
export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;

  try {
    const [{ data: payments }, { data: sub }, { data: cards }] = await Promise.all([
      supabase.from('payments')
        .select('id, amount, refunded_amount, payment_status, payment_date, created_at, payment_method, plan_id')
        .eq('member_id', user.id).eq('gym_id', gym.id)
        .order('payment_date', { ascending: false }).limit(40),
      supabase.from('member_subscriptions')
        .select('start_date, end_date, plan_id, status, membership_plans(name)')
        .eq('member_id', user.id).eq('gym_id', gym.id).in('status', ['active', 'past_due', 'paused', 'pause_requested'])
        .order('end_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('saved_cards')
        .select('id, brand, last4, exp_month, exp_year, bank, is_default')
        .eq('member_id', user.id).eq('gym_id', gym.id).eq('is_active', true)
        .order('is_default', { ascending: false }),
    ]);

    const txns = (payments ?? []) as Payment[];
    const eff = (p: Payment) => p.payment_date ?? p.created_at;
    const successful = txns.filter((p) => p.payment_status === 'successful');
    const totalSpent = successful.reduce((s, p) => s + paymentAmounts(p).net, 0);

    // Last 6 months of successful spend (UTC buckets), oldest first.
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
      return {
        key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
        label: d.toLocaleDateString('en-NG', { month: 'short', timeZone: 'UTC' }),
        amount: 0,
      };
    });
    for (const p of successful) {
      const e = eff(p); if (!e) continue;
      const d = new Date(e);
      const m = months.find((mo) => mo.key === `${d.getUTCFullYear()}-${d.getUTCMonth()}`);
      if (m) m.amount += paymentAmounts(p).net;
    }

    const planName = (sub as unknown as { membership_plans: { name: string } | null } | null)?.membership_plans?.name ?? null;
    const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
    const displayState = sub ? membershipDisplayState({
      status: sub.status, startDate: sub.start_date, daysRemaining: remaining, today: watDateISO(),
    }) : null;

    return json({
      total_spent: totalSpent,
      this_month: months[months.length - 1].amount,
      months: months.map((m) => ({ label: m.label, amount: m.amount })),
      subscription: sub
        ? {
            plan_name: planName,
            start_date: sub.start_date,
            end_date: sub.end_date,
            days_left: remaining,
            status: sub.status,
            display_state: displayState,
          }
        : null,
      cards: (cards ?? []).map((c) => ({
        id: c.id, brand: c.brand, last4: c.last4,
        exp_month: c.exp_month, exp_year: c.exp_year, bank: c.bank, is_default: c.is_default,
      })),
      transactions: txns.map((p) => {
        const amounts = paymentAmounts(p);
        return {
          id: p.id,
          amount: amounts.net,
          gross_amount: amounts.gross,
          refunded_amount: amounts.refunded,
          refund_state: amounts.refundState,
          status: p.payment_status,
          status_label: paymentStatusLabel(p),
          date: eff(p),
          method: p.payment_method ?? 'Paystack',
        };
      }),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

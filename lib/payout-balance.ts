import 'server-only';
import type { createClient } from '@/lib/supabase/server';

// What an instructor may withdraw: lifetime revenue share minus everything
// already requested/approved/paid. Shares the earnings formula with the coach
// earnings/dashboard pages (share of instructor_subscriptions.amount_paid).
// Kept out of the 'use server' action module so it isn't exposed as an action.
export async function availableBalance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gymId: string, instructorId: string, sharePct: number,
): Promise<number> {
  const [{ data: subs }, { data: payouts }] = await Promise.all([
    // Exclude cancelled packs. 'expired' still counts — the member had the
    // sessions — but a cancelled pack is revenue the gym did not keep, and
    // summing it credited the coach a share of money that was never earned,
    // which requestPayout would then approve for real transfer. No app path
    // writes 'cancelled' today (the status is set directly in the DB), so this
    // is a latent hole rather than a live one; the filter closes it before a
    // cancellation feature makes it reachable.
    supabase.from('instructor_subscriptions').select('amount_paid')
      .eq('gym_id', gymId).eq('instructor_id', instructorId).neq('status', 'cancelled'),
    supabase.from('instructor_payouts').select('amount, status').eq('gym_id', gymId).eq('instructor_id', instructorId),
  ]);
  const gross = (subs ?? []).reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
  const earned = Math.floor((gross * sharePct) / 100);
  const committed = (payouts ?? []).filter((p) => p.status !== 'rejected').reduce((s, p) => s + Number(p.amount ?? 0), 0);
  return Math.max(0, earned - committed);
}

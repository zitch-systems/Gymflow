import type { SupabaseClient } from '@supabase/supabase-js';
import { commissionColumns, type SplitRecord } from '@/lib/paystack-split';
import type { PlanDuration } from '@/lib/plan-duration';

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
export type MemberChargeResult = { ok: true; created: boolean; paymentId: string; endDate: string | null }
  | { ok: false; error: string };

// Payment and paid access commit together. A duplicate reference can only see
// committed fulfillment, rather than a row inserted just before a crash.
export async function settleMemberCharge(sb: SupabaseClient, input: {
  reference: string; gymId: string; memberId: string; planId: string; amountKobo: number;
  currency: string; period: PlanDuration; trainerAddon?: boolean | null;
  method: string; split?: SplitRecord | null; subscriptionId?: string | null;
}): Promise<MemberChargeResult> {
  const { data, error } = await (sb as unknown as RpcClient).rpc('settle_member_charge', {
    p_reference: input.reference, p_gym_id: input.gymId, p_member_id: input.memberId,
    p_plan_id: input.planId, p_amount_kobo: input.amountKobo, p_currency: input.currency,
    p_days: input.period.duration_days ?? null, p_months: input.period.duration_months ?? null,
    p_trainer_addon: input.trainerAddon ?? null, p_method: input.method,
    p_commission: commissionColumns(input.split ?? null), p_subscription_id: input.subscriptionId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { created?: unknown; payment_id?: unknown; end_date?: unknown } | null;
  if (!row || typeof row.created !== 'boolean' || typeof row.payment_id !== 'string') {
    return { ok: false, error: 'Payment fulfillment returned no confirmed result.' };
  }
  return { ok: true, created: row.created, paymentId: row.payment_id, endDate: typeof row.end_date === 'string' ? row.end_date : null };
}

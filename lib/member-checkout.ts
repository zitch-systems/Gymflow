import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

// Paystack metadata is echoed from the checkout, not proof that our server
// priced it. Keep the authorized price and term against a server-owned reference.
export async function reserveMemberCheckout(input: {
  gymId: string; memberId: string; planId: string; amountKobo: number;
  durationDays: number | null; durationMonths: number | null; trainerAddon: boolean;
  providerPlanCode?: string;
}, client?: ReturnType<typeof createAdminClient>): Promise<{ ok: true; reference: string } | { ok: false; error: string }> {
  try {
    const reference = `GYM-${randomUUID()}`;
    const admin = client ?? createAdminClient();
    const { error } = await admin.from('member_payment_checkouts' as never).insert({
      reference, gym_id: input.gymId, member_id: input.memberId, plan_id: input.planId,
      amount_kobo: input.amountKobo, currency: 'NGN', duration_days: input.durationDays,
      duration_months: input.durationMonths, trainer_addon: input.trainerAddon,
      provider_plan_code: input.providerPlanCode ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true, reference };
  } catch (e) {
    console.error('[member-checkout] reservation failed:', (e as Error).message);
    return { ok: false, error: 'We couldn’t prepare your payment. Please try again shortly.' };
  }
}

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

export async function reserveAutoRenewalCheckout(input: {
  gymId: string; memberId: string; planId: string; amountKobo: number;
  durationDays: number | null; durationMonths: number | null; trainerAddon: boolean;
  providerPlanCode: string;
}, admin: ReturnType<typeof createAdminClient>): Promise<
  { ok: true; created: boolean; reference: string; url: string | null; state: string } |
  { ok: false; error: string }
> {
  const { data, error } = await admin.rpc('reserve_member_auto_renewal' as never, {
    p_reference: `GYM-${randomUUID()}`, p_gym_id: input.gymId, p_member_id: input.memberId,
    p_plan_id: input.planId, p_amount_kobo: input.amountKobo,
    p_days: input.durationDays, p_months: input.durationMonths,
    p_trainer: input.trainerAddon, p_plan_code: input.providerPlanCode,
  } as never);
  if (error) return { ok: false, error: error.code === '22023' ? error.message : 'We couldn’t confirm your auto-renew settings. Please try again shortly.' };
  const row = data as unknown as { created?: unknown; reference?: unknown; url?: unknown; state?: unknown } | null;
  if (!row || typeof row.created !== 'boolean' || typeof row.reference !== 'string' || typeof row.state !== 'string')
    return { ok: false, error: 'We couldn’t confirm your checkout. Please contact the gym before starting another.' };
  return { ok: true, created: row.created, reference: row.reference, state: row.state, url: typeof row.url === 'string' ? row.url : null };
}

export async function finishAutoRenewalInitialization(admin: ReturnType<typeof createAdminClient>, input: {
  reference: string; url?: string; definiteFailure?: boolean; error?: string;
}): Promise<boolean> {
  const { data, error } = await admin.rpc('finish_member_auto_renewal_initialization' as never, {
    p_reference: input.reference, p_url: input.url ?? null,
    p_definite_failure: input.definiteFailure === true, p_error: input.error ?? null,
  } as never);
  if (error || data !== true) return false;
  return true;
}

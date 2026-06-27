'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { updateSubaccountCommission } from '@/lib/paystack';

export type CommissionState = { ok: boolean; error: string | null; message?: string };

// Set a gym's platform commission %, platform-operator only. Persists the new
// rate and, when the gym already has a Paystack subaccount, pushes it live (the
// subaccount's percentage_charge is otherwise fixed at creation). Service-role
// client: this is a trusted superadmin write, gated by requirePlatformAdmin.
export async function setGymCommission(_prev: CommissionState, formData: FormData): Promise<CommissionState> {
  const gymId = String(formData.get('gymId') ?? '');
  const pct = Number(formData.get('pct'));
  if (!gymId) return { ok: false, error: 'Missing gym.' };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: 'Enter a percentage between 0 and 100.' };

  const admin = await requirePlatformAdmin();
  const db = createAdminClient();
  const { data: gym, error } = await db.from('gyms')
    .update({ platform_commission_pct: pct })
    .eq('id', gymId)
    .select('paystack_subaccount_code')
    .single();
  if (error) return { ok: false, error: error.message };

  if (gym?.paystack_subaccount_code && process.env.PAYSTACK_SECRET_KEY) {
    const r = await updateSubaccountCommission(gym.paystack_subaccount_code, pct);
    if (!r.ok) return { ok: false, error: `Saved, but the live Paystack split wasn’t updated: ${r.error}` };
  }

  logAudit({ action: 'gym_commission_updated', table: 'gyms', actorId: admin.id, gymId, recordId: gymId, values: { pct } });
  revalidatePath('/superadmin/gyms');
  revalidatePath('/superadmin');
  return { ok: true, error: null, message: 'Commission updated.' };
}

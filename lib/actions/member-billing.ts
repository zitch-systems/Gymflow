'use server';

import { revalidatePath } from 'next/cache';
import { disableMemberSubscription } from '@/lib/member-billing-core';
import { startAutoRenewalCore, type StartResult as CoreStartResult } from '@/lib/member-auto-renew-core';
export type StartResult = CoreStartResult;
import { requireMember, requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { requestOrigin } from '@/lib/request-origin';

// Member auto-recurring billing. Mirrors the platform-billing pattern for
// members: opt-in creates a Paystack Subscription (lazy-creating the Plan on
// first use per membership plan), cancel disables it at Paystack.
//
// Two entry points for cancel: self-serve (member turns their own off) and
// staff override (admin turns it off for a member). Both funnel through the
// same disable + audit-log path so the outcomes are identical.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionState = { ok: boolean; error: string | null; message?: string };

export async function startAutoRenewal(planId: string, withTrainer = false): Promise<StartResult> {
  const { user, gym } = await requireMember();
  const site = await requestOrigin();
  return startAutoRenewalCore(user, gym, planId, withTrainer, site ? `${site}/dashboard/renew/callback` : undefined);
}

export async function cancelAutoRenewSelf(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireMember();
    const result = await disableMemberSubscription(subId, { userId: user.id, gymId: gym.id, role: 'member' });
    if (result.ok) {
      revalidatePath('/dashboard');
      revalidatePath('/dashboard/renew');
      revalidatePath('/dashboard/profile');
    }
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function cancelAutoRenewByStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const subId = String(formData.get('subId') ?? '');
  if (!UUID_RE.test(subId)) return { ok: false, error: 'Invalid subscription id.' };
  try {
    const { user, gym } = await requireStaff(ADMIN_ROLES);
    const result = await disableMemberSubscription(subId, { userId: user.id, gymId: gym.id, role: 'staff' });
    if (result.ok) {
      // We don't have the member id in the form; just revalidate the members
      // index and the current gym's admin surfaces.
      const supabase = await createClient();
      const { data: sub } = await supabase.from('member_subscriptions').select('member_id').eq('id', subId).maybeSingle();
      if (sub?.member_id) revalidatePath(`/admin/members/${sub.member_id}`);
    }
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

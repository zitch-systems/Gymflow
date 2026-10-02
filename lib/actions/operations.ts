'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export async function requeuePaymentWebhook(formData: FormData): Promise<void> {
  await requirePlatformAdmin();
  const bodyHash = String(formData.get('body_hash') ?? '');
  if (!/^[a-f0-9]{64}$/i.test(bodyHash)) throw new Error('Invalid recovery job.');

  const supabase = await createClient();
  const { data: proven, error: proofError } = await supabase.rpc('privileged_session_verified' as never);
  if (proofError || proven !== true) throw new Error('A current privileged-session proof is required. Sign in again.');

  const { data: changed, error } = await supabase.rpc('requeue_payment_webhook_job' as never, {
    p_body_hash: bodyHash,
  } as never);
  if (error) throw new Error('The recovery job could not be requeued.');
  if (changed !== true) throw new Error('Only a dead recovery job can be requeued.');
  revalidatePath('/superadmin/operations');
}

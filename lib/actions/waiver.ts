'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export async function signWaiver(): Promise<void> {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const now = new Date().toISOString();
  const { data: activeWaiver, error: waiverError } = await supabase
    .from('waivers')
    .select('id')
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (waiverError) {
    throw new Error('Unable to load the active waiver. Please try again.');
  }

  // Record the versioned gym waiver before unlocking the member app. This
  // prevents a failed signature insert from leaving the member marked as signed
  // without the corresponding legal record.
  if (activeWaiver) {
    const { error: signatureError } = await supabase.from('waiver_signatures').insert({
      gym_id: gym.id,
      waiver_id: activeWaiver.id,
      member_id: user.id,
      signed_at: now,
    });

    if (signatureError) {
      throw new Error('Unable to record your waiver signature. Please try again.');
    }
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ waiver_signed_at: now })
    .eq('id', user.id);

  if (profileError) {
    throw new Error('Unable to complete waiver acceptance. Please try again.');
  }

  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard');
}

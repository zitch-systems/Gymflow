'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export async function signWaiver(): Promise<void> {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const now = new Date().toISOString();
  await supabase.from('profiles').update({ waiver_signed_at: now }).eq('id', user.id);

  const { data: activeWaiver } = await supabase
    .from('waivers')
    .select('id')
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (activeWaiver) {
    await supabase.from('waiver_signatures').insert({
      gym_id: gym.id,
      waiver_id: activeWaiver.id,
      member_id: user.id,
      signed_at: now,
    });
  }

  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard');
}

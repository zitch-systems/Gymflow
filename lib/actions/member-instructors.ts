'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/gym';

type Result = { ok: boolean; error?: string };

export async function cancelInstructorSubscription(slug: string, subscriptionId: string): Promise<Result> {
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();

  // Cancel means: mark status, keep end_date so the member retains access
  // until it expires, and disable auto-renew.
  const { error } = await supabase
    .from('instructor_subscriptions')
    .update({ status: 'cancelled', auto_renew: false })
    .eq('id', subscriptionId)
    .eq('member_id', user.id)
    .eq('gym_id', gym.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/dashboard/instructors`);
  revalidatePath(`/gym/${slug}/dashboard/instructors/[id]`, 'page');
  return { ok: true };
}

export async function setInstructorAutoRenew(
  slug: string,
  subscriptionId: string,
  autoRenew: boolean,
): Promise<Result> {
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from('instructor_subscriptions')
    .update({ auto_renew: autoRenew })
    .eq('id', subscriptionId)
    .eq('member_id', user.id)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/dashboard/instructors/[id]`, 'page');
  return { ok: true };
}

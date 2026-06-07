'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type CheckinResult = { ok: true; daysLeft: number | null } | { ok: false; error: string };

// Self check-in — inserts a check_in row for the signed-in member at their gym.
// RLS scopes the insert to the caller; daysLeft is read back from their active
// subscription for the success message.
export async function selfCheckIn(): Promise<CheckinResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in to check in.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('check_ins').insert({
    member_id: user.id,
    gym_id: gym.id,
    check_in_method: 'self',
    checked_in_at: new Date().toISOString(),
    status: 'checked_in',
  });
  if (error) return { ok: false, error: error.message };

  const { data: sub } = await supabase
    .from('member_subscriptions')
    .select('end_date')
    .eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();

  const daysLeft = sub?.end_date ? Math.max(0, Math.ceil((new Date(sub.end_date).getTime() - Date.now()) / 86_400_000)) : null;
  revalidatePath('/dashboard');
  return { ok: true, daysLeft };
}

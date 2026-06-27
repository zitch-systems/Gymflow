'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type CheckinResult = { ok: true; daysLeft: number | null } | { ok: false; error: string };

// Self check-in — inserts a check_in row for the signed-in member at their gym.
// Entry requires a non-suspended membership link AND an active, non-expired
// subscription; repeat taps within the same day are de-duplicated (a member
// already inside isn't logged twice). RLS scopes every query to the caller.
export async function selfCheckIn(): Promise<CheckinResult> {
  let user, gym;
  try {
    ({ user, gym } = await requireMember());
  } catch {
    return { ok: false, error: 'Please sign in to check in.' };
  }

  const supabase = await createClient();

  // Suspended members (gym_member_links.is_active = false) can't enter.
  const { data: link } = await supabase
    .from('gym_member_links').select('is_active')
    .eq('gym_id', gym.id).or(`member_id.eq.${user.id},user_id.eq.${user.id}`)
    .maybeSingle();
  if (link && link.is_active === false) {
    return { ok: false, error: 'Your membership is suspended. Please see the front desk.' };
  }

  // Require an active, non-expired subscription to check in.
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: sub } = await supabase
    .from('member_subscriptions')
    .select('end_date')
    .eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  if (!sub || (sub.end_date ?? '') < todayStr) {
    return { ok: false, error: 'Your membership isn’t active. Renew to check in.' };
  }
  const daysLeft = sub.end_date ? Math.max(0, Math.ceil((new Date(sub.end_date).getTime() - Date.now()) / 86_400_000)) : null;

  // Already checked in today? Treat a repeat as success without a duplicate row.
  const { data: existing } = await supabase
    .from('check_ins').select('id')
    .eq('member_id', user.id).eq('gym_id', gym.id)
    .gte('checked_in_at', `${todayStr}T00:00:00.000Z`)
    .limit(1).maybeSingle();
  if (existing) { revalidatePath('/dashboard'); return { ok: true, daysLeft }; }

  const { error } = await supabase.from('check_ins').insert({
    member_id: user.id,
    gym_id: gym.id,
    check_in_method: 'self',
    checked_in_at: new Date().toISOString(),
    status: 'active',
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard');
  return { ok: true, daysLeft };
}

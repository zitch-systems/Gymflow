'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/gym';

// Mark a single in-app notification as read. RLS (notif_update_self in
// 20260530_notif_update_self.sql) ensures the user-scoped client can only
// touch rows the caller owns, so an attacker can't read-flag someone else's
// notifications via a forged id.
export async function markNotificationRead(slug: string, id: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id);
  // Bell-badge counts are rendered on multiple member surfaces; revalidate
  // the inbox itself (definitely stale) and the dashboard root (where the
  // bell lives). The other member tabs re-read on navigation.
  revalidatePath(`/gym/${slug}/dashboard/inbox`);
  revalidatePath(`/gym/${slug}/dashboard`);
}

// Mark every unread notification for the current user AT THIS GYM as read.
// Must be gym-scoped: a member of more than one gym would otherwise clear
// another gym's unread inbox (and zero its badge) by tapping "mark all" here.
// The inbox list and the dashboard bell badge both filter by gym_id, so this
// has to match. requireMember resolves the gym and confirms membership.
export async function markAllNotificationsRead(slug: string): Promise<void> {
  const { gym } = await requireMember(slug);
  const supabase = await createClient();
  // RLS already constrains the update to user_id = auth.uid(); the gym_id
  // filter narrows it to the inbox the member is actually looking at.
  await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('gym_id', gym.id)
    .eq('is_read', false);
  revalidatePath(`/gym/${slug}/dashboard/inbox`);
  revalidatePath(`/gym/${slug}/dashboard`);
}

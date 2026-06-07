'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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

// Mark every unread notification for the current user as read. Avoids N
// round-trips and gives the inbox a single "mark all" action.
export async function markAllNotificationsRead(slug: string): Promise<void> {
  const supabase = await createClient();
  // No member-id filter needed — RLS USING constrains the update to
  // user_id = auth.uid(), so this is implicitly scoped to the caller.
  await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false);
  revalidatePath(`/gym/${slug}/dashboard/inbox`);
  revalidatePath(`/gym/${slug}/dashboard`);
}

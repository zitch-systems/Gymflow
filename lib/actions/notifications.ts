'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

// Mark every unread notification of the signed-in user as read. Runs on the
// user session — needs the notifications self-UPDATE RLS policy
// (supabase/migrations/20260609_self_service_policies.sql).
export async function markAllRead(): Promise<void> {
  const user = await requireAuth();
  const supabase = await createClient();
  await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_read', false);
  revalidatePath('/dashboard/inbox');
  revalidatePath('/dashboard');
}

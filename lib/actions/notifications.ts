'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

// Mark every unread notification of the signed-in user as read. Runs on the
// user session — needs the notifications self-UPDATE RLS policy
// (supabase/migrations/20260609_self_service_policies.sql).
export async function markAllRead(): Promise<{ ok: boolean; error: string | null }> {
  const user = await requireAuth();
  const supabase = await createClient();
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_read', false);
  if (error) return { ok: false, error: 'We could not mark your notifications as read. Please try again.' };
  revalidatePath('/dashboard/inbox');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/profile');
  return { ok: true, error: null };
}

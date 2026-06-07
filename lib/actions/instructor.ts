'use server';

import { revalidatePath } from 'next/cache';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type MarkResult = { ok: boolean; error: string | null };

// Mark a PT session attended/no-show. RLS (isess_update_instructor) restricts
// updates to the instructor's own sessions, so the user session suffices.
export async function markSession(sessionId: string, status: 'completed' | 'no_show'): Promise<MarkResult> {
  const { user } = await requireInstructor();
  const supabase = await createClient();
  const { error } = await supabase
    .from('instructor_sessions')
    .update({ status, marked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('instructor_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/coach/attendance');
  revalidatePath('/coach');
  return { ok: true, error: null };
}

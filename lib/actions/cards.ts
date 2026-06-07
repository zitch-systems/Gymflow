'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/dal';

export async function deleteSavedCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('saved_cards')
    .update({ is_active: false, reusable: false })
    .eq('id', cardId)
    .eq('member_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/cards');
  return { ok: true };
}

export async function setDefaultSavedCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  const supabase = await createClient();
  await supabase.from('saved_cards').update({ is_default: false }).eq('member_id', user.id);
  const { error } = await supabase
    .from('saved_cards')
    .update({ is_default: true })
    .eq('id', cardId)
    .eq('member_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/cards');
  return { ok: true };
}

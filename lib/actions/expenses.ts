'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';

export async function upsertExpense(slug: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const id = String(formData.get('id') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const category = String(formData.get('category') ?? '').trim();
  const amount = Number(formData.get('amount') ?? 0);
  const expense_date = String(formData.get('expense_date') ?? new Date().toISOString().split('T')[0]);
  const is_recurring = formData.get('is_recurring') !== null;
  const recurring_frequency = String(formData.get('recurring_frequency') ?? '').trim() || null;
  const receipt_url = String(formData.get('receipt_url') ?? '').trim() || null;

  if (!category) return { ok: false, error: 'Category required' };
  if (!amount || amount <= 0) return { ok: false, error: 'Amount must be > 0' };

  const supabase = await createClient();
  const row = {
    gym_id: gym.id,
    description,
    category,
    amount,
    expense_date,
    is_recurring,
    recurring_frequency,
    receipt_url,
  };
  if (id) {
    const { error } = await supabase.from('expenses').update(row).eq('id', id).eq('gym_id', gym.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('expenses').insert(row);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/admin/operations');
  revalidatePath('/admin/analytics');
  return { ok: true };
}

export async function deleteExpense(slug: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const supabase = await createClient();
  const { error } = await supabase.from('expenses').delete().eq('id', id).eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/operations');
  revalidatePath('/admin/analytics');
  return { ok: true };
}

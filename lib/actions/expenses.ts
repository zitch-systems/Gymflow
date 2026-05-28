'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { audit } from '@/lib/audit';

export async function upsertExpense(slug: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
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
    const { data: before } = await supabase
      .from('expenses')
      .select('description, category, amount, expense_date, is_recurring')
      .eq('id', id)
      .eq('gym_id', gym.id)
      .maybeSingle();
    const { error } = await supabase.from('expenses').update(row).eq('id', id).eq('gym_id', gym.id);
    if (error) return { ok: false, error: error.message };
    await audit(supabase, {
      gymId: gym.id,
      actorId: actor?.id ?? null,
      action: 'admin.expense_updated',
      table: 'expenses',
      recordId: id,
      before: before ?? null,
      after: row,
    });
  } else {
    const { data: created, error } = await supabase.from('expenses').insert(row).select('id').maybeSingle();
    if (error) return { ok: false, error: error.message };
    await audit(supabase, {
      gymId: gym.id,
      actorId: actor?.id ?? null,
      action: 'admin.expense_created',
      table: 'expenses',
      recordId: created?.id ?? null,
      after: row,
    });
  }
  revalidatePath('/admin/operations');
  revalidatePath('/admin/analytics');
  return { ok: true };
}

export async function deleteExpense(slug: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const supabase = await createClient();
  const { data: before } = await supabase
    .from('expenses')
    .select('description, category, amount, expense_date')
    .eq('id', id)
    .eq('gym_id', gym.id)
    .maybeSingle();
  const { error } = await supabase.from('expenses').delete().eq('id', id).eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  await audit(supabase, {
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.expense_deleted',
    table: 'expenses',
    recordId: id,
    before: before ?? null,
  });
  revalidatePath('/admin/operations');
  revalidatePath('/admin/analytics');
  return { ok: true };
}

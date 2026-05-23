'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInstructor } from '@/lib/auth/gym';

type Result = { ok: boolean; error?: string };

export async function scheduleSession(slug: string, formData: FormData): Promise<Result> {
  const { gym, user } = await requireInstructor(slug);
  const memberId = String(formData.get('member_id') ?? '').trim();
  const scheduledAt = String(formData.get('scheduled_at') ?? '').trim();
  const durationRaw = String(formData.get('duration_minutes') ?? '60').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!memberId || !scheduledAt) return { ok: false, error: 'Member and time required' };

  const supabase = await createClient();
  const { error } = await supabase.from('instructor_sessions').insert({
    gym_id: gym.id,
    instructor_id: user.id,
    member_id: memberId,
    scheduled_at: new Date(scheduledAt).toISOString(),
    duration_minutes: Number(durationRaw) || 60,
    notes,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/gym/${slug}/coach`);
  revalidatePath(`/gym/${slug}/coach/attendance`);
  return { ok: true };
}

export async function markSessionStatus(
  slug: string,
  sessionId: string,
  status: 'completed' | 'no_show' | 'cancelled',
): Promise<Result> {
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from('instructor_sessions')
    .update({ status, marked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/coach/attendance`);
  return { ok: true };
}

export async function markClassAttendance(
  slug: string,
  bookingId: string,
  attended: boolean,
): Promise<Result> {
  const { gym } = await requireInstructor(slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from('class_bookings')
    .update({ checked_in: attended })
    .eq('id', bookingId)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/coach/attendance`);
  return { ok: true };
}

export async function requestPayout(slug: string, formData: FormData): Promise<Result> {
  const { gym, user } = await requireInstructor(slug);
  const amountRaw = String(formData.get('amount') ?? '').trim();
  const amount = Number(amountRaw);
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!amount || amount <= 0) return { ok: false, error: 'Enter a valid amount' };

  const supabase = await createClient();
  const { error } = await supabase.from('instructor_payouts').insert({
    gym_id: gym.id,
    instructor_id: user.id,
    amount,
    notes,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/coach/earnings`);
  return { ok: true };
}

export async function updateInstructorProfile(slug: string, formData: FormData): Promise<Result> {
  const { user } = await requireInstructor(slug);
  const updates = {
    bio: String(formData.get('bio') ?? '').trim() || null,
    specialisation: String(formData.get('specialisation') ?? '').trim() || null,
    certifications: String(formData.get('certifications') ?? '').trim() || null,
    photo_url: String(formData.get('photo_url') ?? '').trim() || null,
    updated_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/coach/profile`);
  return { ok: true };
}

export async function updateInstructorRate(slug: string, formData: FormData): Promise<Result> {
  const { gym, user } = await requireInstructor(slug);
  const priceRaw = String(formData.get('price') ?? '').trim();
  const price = Number(priceRaw);
  if (!price || price <= 0) return { ok: false, error: 'Enter a valid rate' };

  // Admin client because instructor_pricing may be admin-controlled.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('instructor_pricing')
    .select('id')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .eq('billing_period', 'monthly')
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
      .from('instructor_pricing')
      .update({ price, is_active: true })
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from('instructor_pricing').insert({
      gym_id: gym.id,
      instructor_id: user.id,
      duration_days: 30,
      price,
      billing_period: 'monthly',
      currency: 'NGN',
      is_active: true,
    });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/gym/${slug}/coach/profile`);
  return { ok: true };
}

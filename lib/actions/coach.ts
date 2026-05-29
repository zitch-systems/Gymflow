'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInstructor } from '@/lib/auth/gym';
import { resolveAccount } from '@/lib/paystack';

type Result = { ok: boolean; error?: string };

export async function scheduleSession(slug: string, formData: FormData): Promise<Result> {
  const { gym, user } = await requireInstructor(slug);
  const memberId = String(formData.get('member_id') ?? '').trim();
  const scheduledAt = String(formData.get('scheduled_at') ?? '').trim();
  const durationRaw = String(formData.get('duration_minutes') ?? '60').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!memberId || !scheduledAt) return { ok: false, error: 'Member and time required' };

  const supabase = await createClient();
  // Prevent IDOR: the member must actually belong to this gym.
  const { data: memberLink } = await supabase
    .from('gym_member_links')
    .select('user_id')
    .eq('gym_id', gym.id)
    .eq('user_id', memberId)
    .maybeSingle();
  if (!memberLink) return { ok: false, error: 'That member is not part of this gym' };

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

  // Cap the request to what's actually available: lifetime revenue-share earned
  // minus what's already paid out or pending. Prevents self-service over-requests.
  const sharePct = gym.instructor_revenue_share_pct ?? 50;
  const [{ data: subs }, { data: payouts }] = await Promise.all([
    supabase.from('instructor_subscriptions').select('amount_paid').eq('gym_id', gym.id).eq('instructor_id', user.id),
    supabase.from('instructor_payouts').select('amount, status').eq('gym_id', gym.id).eq('instructor_id', user.id),
  ]);
  const gross = (subs ?? []).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
  const earned = Math.round((gross * sharePct) / 100);
  const committed = (payouts ?? [])
    .filter((p) => p.status === 'paid' || p.status === 'requested' || p.status === 'approved')
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const available = Math.max(0, earned - committed);
  if (amount > available) {
    return { ok: false, error: `You can request at most ₦${available.toLocaleString('en-NG')}` };
  }

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

export async function saveBankDetails(slug: string, formData: FormData): Promise<Result> {
  const { user } = await requireInstructor(slug);
  const bankCode = String(formData.get('bank_code') ?? '').trim();
  const bankName = String(formData.get('bank_name') ?? '').trim();
  const accountNumber = String(formData.get('account_number') ?? '').trim();
  if (!/^\d{3,6}$/.test(bankCode)) return { ok: false, error: 'Invalid bank code' };
  if (!/^\d{10}$/.test(accountNumber)) return { ok: false, error: 'Account number must be 10 digits' };
  if (!bankName) return { ok: false, error: 'Bank name required' };

  // Resolve against Paystack so we store the verified account name and catch
  // a wrong NUBAN before payout time — the admin paying out trusts this name.
  let accountName: string;
  try {
    const resolved = await resolveAccount(accountNumber, bankCode);
    accountName = resolved.account_name;
  } catch (e) {
    return { ok: false, error: `Could not verify account: ${(e as Error).message}` };
  }

  // User-scoped client: RLS (instructor_bank_details_*_own) enforces that a
  // coach can only write their own row. instructor_bank_details isn't in the
  // generated types yet (20260529_instructor_bank_details.sql); cast through
  // `never`.
  const supabase = await createClient();
  const { error } = await supabase
    .from('instructor_bank_details' as never)
    .upsert(
      {
        instructor_id: user.id,
        bank_code: bankCode,
        bank_name: bankName,
        account_number: accountNumber,
        account_name: accountName,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'instructor_id' } as never,
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/coach/profile`);
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

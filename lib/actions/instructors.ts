'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { sendTempPassword } from '@/lib/email';
import { waTempPassword } from '@/lib/whatsapp';
import { escapeIlikeEmail } from '@/lib/email-lookup';

function tempPassword(): string {
  return 'gf-' + Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function inviteInstructor(slug: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const staff = await getSessionUser();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const specialisation = String(formData.get('specialisation') ?? '').trim();
  const sessionRateRaw = String(formData.get('session_rate') ?? '').trim();
  const sessionRate = sessionRateRaw ? Number(sessionRateRaw) : null;

  if (!email || !fullName) return { ok: false, error: 'Email and name required' };

  const admin = createAdminClient();
  const password = tempPassword();
  let userId: string | null = null;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });
  if (createErr) {
    if (/already.*registered|exists/i.test(createErr.message)) {
      // Resolve via profiles, not auth.admin.listUsers (paginated, breaks at scale).
      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .ilike('email', escapeIlikeEmail(email))
        .maybeSingle();
      userId = existing?.id ?? null;
    } else {
      return { ok: false, error: createErr.message };
    }
  } else {
    userId = created?.user?.id ?? null;
  }
  if (!userId) return { ok: false, error: 'Could not provision instructor' };

  // Only seed the profile for a brand-new account. If the email already belongs
  // to someone (e.g. a member at another gym, or an owner), we must NOT clobber
  // their role/gym_id — that would corrupt another tenant's user and misdirect
  // their login. Instructor access for THIS gym comes from the staff link below,
  // not from profiles.role.
  if (!createErr) {
    await admin
      .from('profiles')
      .upsert(
        {
          id: userId,
          email,
          first_name: fullName.split(/\s+/)[0],
          last_name: fullName.split(/\s+/).slice(1).join(' ') || null,
          phone: phone || null,
          role: 'instructor',
          gym_id: gym.id,
          is_active: true,
        },
        { onConflict: 'id' },
      );
  }

  await admin.from('gym_staff_links').upsert(
    { gym_id: gym.id, user_id: userId, role: 'instructor', is_active: true },
    { onConflict: 'gym_id,user_id,role' },
  );

  if (sessionRate && sessionRate > 0) {
    await admin.from('instructor_pricing').insert({
      gym_id: gym.id,
      instructor_id: userId,
      duration_days: 30,
      price: sessionRate,
      billing_period: 'monthly',
      currency: 'NGN',
      features: { specialisation },
    });
  }

  await admin.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: staff?.id ?? null,
    user_id: userId,
    action: 'admin.instructor_invited',
    table_name: 'profiles',
    record_id: userId,
    new_values: { email, full_name: fullName, specialisation },
  });

  if (!createErr) {
    const loginUrl = `https://${gym.slug}.gymflow.ng/login`;
    try {
      await Promise.allSettled([
        sendTempPassword(email, { name: fullName, gymName: gym.name, tempPassword: password, loginUrl }),
        phone ? waTempPassword(phone, { name: fullName, gymName: gym.name, tempPassword: password, loginUrl }) : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF inviteInstructor] notify failed:', (e as Error).message);
    }
  }

  revalidatePath(`/gym/${slug}/admin/instructors`);
  return { ok: true };
}

export async function setInstructorActive(slug: string, userId: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const { gym } = await requireStaff(slug);
  const admin = createAdminClient();
  const { error } = await admin
    .from('gym_staff_links')
    .update({ is_active: active })
    .eq('gym_id', gym.id)
    .eq('user_id', userId)
    .eq('role', 'instructor');
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gym/${slug}/admin/instructors`);
  return { ok: true };
}

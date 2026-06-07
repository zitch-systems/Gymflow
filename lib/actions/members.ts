'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { sendTempPassword } from '@/lib/email';
import { waTempPassword } from '@/lib/whatsapp';
import { escapeIlikeEmail } from '@/lib/email-lookup';
import { addMonths } from '@/lib/dates';

function tempPassword(): string {
  return 'gf-' + Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function adminOnboardMember(slug: string, formData: FormData): Promise<{ error?: string } | void> {
  const { gym } = await requireStaff(slug);
  const staff = await getSessionUser();

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const dob = String(formData.get('date_of_birth') ?? '').trim() || null;
  const gender = String(formData.get('gender') ?? '').trim() || null;
  const address = String(formData.get('address') ?? '').trim() || null;
  const nokName = String(formData.get('nok_name') ?? '').trim();
  const nokPhone = String(formData.get('nok_phone') ?? '').trim();
  const nokRelationship = String(formData.get('nok_relationship') ?? '').trim();
  const nokAddress = String(formData.get('nok_address') ?? '').trim() || null;
  const healthNotes = String(formData.get('health_notes') ?? '').trim() || null;
  const waiverSigned = formData.get('waiver_signed') !== null;
  const planId = String(formData.get('plan_id') ?? '').trim() || null;
  const paymentAmount = Number(formData.get('payment_amount') ?? 0);
  const rawPaymentMethod = String(formData.get('payment_method') ?? 'cash').trim();
  const VALID_PAYMENT_METHODS = ['card', 'bank_transfer', 'cash', 'crypto'] as const;
  type ValidPaymentMethod = typeof VALID_PAYMENT_METHODS[number];
  const paymentMethod: ValidPaymentMethod = (VALID_PAYMENT_METHODS as readonly string[]).includes(rawPaymentMethod)
    ? (rawPaymentMethod as ValidPaymentMethod)
    : 'cash';

  if (!email || !fullName) return { error: 'Name and email are required.' };

  const admin = createAdminClient();
  const password = tempPassword();
  let userId: string | null = null;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone,
      date_of_birth: dob,
      gender,
      address,
      nok_name: nokName,
      nok_relationship: nokRelationship,
      nok_phone: nokPhone,
      nok_address: nokAddress,
      health_notes: healthNotes,
      waiver_signed: waiverSigned,
      signup_gym_slug: gym.slug,
    },
  });

  if (createErr) {
    if (!/already.*registered|exists/i.test(createErr.message)) {
      return { error: createErr.message };
    }
    // Resolve existing user via profiles (auth.admin.listUsers is paginated
    // and breaks past 50 users — silently misses lookups at scale).
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', escapeIlikeEmail(email))
      .maybeSingle();
    userId = existing?.id ?? null;
    if (!userId) return { error: 'Email is already taken by another account.' };
  } else {
    userId = created?.user?.id ?? null;
  }
  if (!userId) return { error: 'Could not resolve member id.' };

  // The trigger writes the profile + gym_member_links when a new auth user
  // is created. When the user already existed we still need to make sure
  // the gym link is in place.
  await admin
    .from('gym_member_links')
    .upsert(
      { gym_id: gym.id, user_id: userId, member_id: userId, onboarding_method: 'admin_manual', is_active: true, status: 'active', joined_at: new Date().toISOString() },
      { onConflict: 'gym_id,user_id' },
    );

  // Optional initial subscription + payment if amount > 0
  if (planId && paymentAmount > 0) {
    const { data: plan } = await admin.from('membership_plans').select('duration_months').eq('id', planId).maybeSingle();
    if (plan) {
      const start = new Date();
      const end = addMonths(start, Number(plan.duration_months ?? 1));
      const { data: mem } = await admin
        .from('memberships')
        .insert({
          gym_id: gym.id,
          member_id: userId,
          plan_id: planId,
          status: 'active',
          start_date: start.toISOString().split('T')[0],
          end_date: end.toISOString().split('T')[0],
        })
        .select('id')
        .maybeSingle();

      await admin.from('payments').insert({
        gym_id: gym.id,
        member_id: userId,
        plan_id: planId,
        amount: paymentAmount,
        currency: 'NGN',
        payment_method: paymentMethod,
        payment_status: 'successful',
        payment_date: new Date().toISOString(),
        metadata: { source: 'admin_manual_onboarding', membership_id: mem?.id ?? null },
      });
    }
  }

  // Audit
  await admin.from('audit_logs').insert({
    gym_id: gym.id,
    actor_id: staff?.id ?? null,
    user_id: userId,
    action: 'admin.member_onboarded',
    table_name: 'profiles',
    record_id: userId,
    new_values: { email, full_name: fullName },
  });

  // Notify member with their temp password (only when we created them now)
  if (!createErr) {
    const loginUrl = `https://${gym.slug}.gymflow.ng/login`;
    try {
      await Promise.allSettled([
        sendTempPassword(email, { name: fullName, gymName: gym.name, tempPassword: password, loginUrl }),
        phone ? waTempPassword(phone, { name: fullName, gymName: gym.name, tempPassword: password, loginUrl }) : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF adminOnboardMember] temp-pw notification failed:', (e as Error).message);
    }
  }

  revalidatePath('/admin/members');
  redirect(`/admin/members/${userId}`);
}

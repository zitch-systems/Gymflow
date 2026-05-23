'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProfile } from '@/lib/auth/dal';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

const DEFAULT_PLANS = [
  { name: 'Monthly', duration_months: 1, price: 20_000 },
  { name: 'Quarterly · save 5%', duration_months: 3, price: 57_000 },
  { name: '6 months · save 10%', duration_months: 6, price: 108_000 },
  { name: 'Annual · save 17%', duration_months: 12, price: 200_000 },
];

async function requirePlatformAdmin() {
  const profile = await getProfile();
  if (!profile || profile.role !== 'platform_admin') {
    throw new Error('Platform admin only');
  }
  return profile;
}

export type OnboardResult = { ok: true; slug: string } | { ok: false; error: string };

export async function platformOnboardGym(formData: FormData): Promise<OnboardResult> {
  await requirePlatformAdmin();

  const gymName = String(formData.get('gym_name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim().toLowerCase();
  const ownerEmail = String(formData.get('owner_email') ?? '').trim().toLowerCase();
  const ownerName = String(formData.get('owner_name') ?? '').trim();
  const ownerPhone = String(formData.get('owner_phone') ?? '').trim();

  if (!gymName) return { ok: false, error: 'Gym name required' };
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'Invalid slug' };
  if (!/.+@.+\..+/.test(ownerEmail)) return { ok: false, error: 'Valid owner email required' };
  if (!ownerName) return { ok: false, error: 'Owner name required' };

  const admin = createAdminClient();

  const { data: existing } = await admin.from('gyms').select('id').eq('slug', slug).maybeSingle();
  if (existing) return { ok: false, error: 'Slug taken' };

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { data: gymRow, error: gymError } = await admin
    .from('gyms')
    .insert({
      name: gymName,
      slug,
      email: ownerEmail,
      phone: ownerPhone || null,
      currency: 'NGN',
      subscription_plan: 'monthly',
      subscription_status: 'active',
      status: 'active',
      trial_ends_at: periodEnd.toISOString(),
    })
    .select('id, slug')
    .single();
  if (gymError || !gymRow) return { ok: false, error: gymError?.message ?? 'Create failed' };

  const tempPassword = 'gf-' + Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  let userId: string | null = null;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: ownerName, phone: ownerPhone || null },
  });
  if (createErr) {
    if (/already.*registered|exists/i.test(createErr.message)) {
      const { data: list } = await admin.auth.admin.listUsers();
      userId = list?.users?.find((u) => u.email?.toLowerCase() === ownerEmail)?.id ?? null;
    } else {
      return { ok: false, error: createErr.message };
    }
  } else {
    userId = created?.user?.id ?? null;
  }
  if (!userId) return { ok: false, error: 'Owner provisioning failed' };

  await admin.from('profiles').upsert(
    {
      id: userId,
      email: ownerEmail,
      first_name: ownerName.split(/\s+/)[0],
      last_name: ownerName.split(/\s+/).slice(1).join(' ') || null,
      phone: ownerPhone || null,
      role: 'gym_owner',
      gym_id: gymRow.id,
      is_active: true,
    },
    { onConflict: 'id' },
  );

  await admin.from('gym_staff_links').upsert(
    { gym_id: gymRow.id, user_id: userId, role: 'gym_owner', is_active: true },
    { onConflict: 'gym_id,user_id' },
  );

  await admin.from('membership_plans').insert(
    DEFAULT_PLANS.map((p) => ({
      gym_id: gymRow.id,
      name: p.name,
      duration_months: p.duration_months,
      price: p.price,
      currency: 'NGN',
      is_active: true,
    })),
  );

  await admin.from('audit_logs').insert({
    gym_id: gymRow.id,
    action: 'platform.gym_onboarded_manually',
    table_name: 'gyms',
    record_id: gymRow.id,
    new_values: { slug, name: gymName, owner_email: ownerEmail },
  });

  revalidatePath('/superadmin');
  return { ok: true, slug: gymRow.slug };
}

export async function platformSetGymStatus(gymId: string, status: 'active' | 'suspended' | 'terminated'): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from('gyms')
    .update({ subscription_status: status, status, updated_at: new Date().toISOString() })
    .eq('id', gymId);
  if (error) return { ok: false, error: error.message };
  await admin.from('audit_logs').insert({
    gym_id: gymId,
    action: `platform.gym_${status}`,
    table_name: 'gyms',
    record_id: gymId,
    new_values: { status },
  });
  revalidatePath('/superadmin');
  return { ok: true };
}

export async function platformImpersonate(userEmail: string): Promise<{ ok: boolean; magicLink?: string; error?: string }> {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: userEmail,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/login` },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, magicLink: data?.properties?.action_link };
}

export async function platformGoToGym(slug: string): Promise<void> {
  await requirePlatformAdmin();
  redirect(`https://${slug}.gymflow.ng/admin/dashboard`);
}

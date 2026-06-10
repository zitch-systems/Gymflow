'use server';

import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

export type OnboardState = { ok: boolean; error: string | null; message?: string };

// Provision a new gym (+ optional owner account). Platform-admin only.
// Uses the service-role admin client: creates the gym row, and if an owner
// email is given, creates/invites the owner auth user + owner staff link.
// Requires SUPABASE_SERVICE_ROLE_KEY — returns a clear error without it.
export async function provisionGym(_prev: OnboardState, formData: FormData): Promise<OnboardState> {
  const actor = await requirePlatformAdmin();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Provisioning needs SUPABASE_SERVICE_ROLE_KEY (server env).' };
  }

  const name = String(formData.get('name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const city = String(formData.get('city') ?? '').trim() || null;
  const plan = String(formData.get('plan') ?? 'starter').trim();
  const ownerEmail = String(formData.get('owner_email') ?? '').trim();
  const ownerName = String(formData.get('owner_name') ?? '').trim();
  if (!name || !slug) return { ok: false, error: 'Gym name and subdomain are required.' };

  const admin = createAdminClient();

  const { data: existing } = await admin.from('gyms').select('id').eq('slug', slug).maybeSingle();
  if (existing) return { ok: false, error: `Subdomain "${slug}" is taken.` };

  const { data: gym, error: gymErr } = await admin
    .from('gyms')
    // status 'active' (the value gyms_status_check accepts); 14-day trial window
    // is tracked in trial_ends_at, not status.
    .insert({ name, slug, city, subscription_plan: plan, status: 'active', trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString() })
    .select('id')
    .single();
  if (gymErr || !gym) return { ok: false, error: gymErr?.message ?? 'Could not create gym.' };

  // Owner account (optional): create the auth user + profile + owner staff link.
  if (ownerEmail) {
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      email_confirm: true,
      user_metadata: { full_name: ownerName, gym_id: gym.id },
    });
    if (authErr) return { ok: true, error: null, message: `Gym created, but owner invite failed: ${authErr.message}` };
    const uid = created.user.id;
    await admin.from('profiles').upsert({ id: uid, email: ownerEmail, full_name: ownerName || null, role: 'owner', gym_id: gym.id });
    await admin.from('gym_staff_links').insert({ user_id: uid, gym_id: gym.id, role: 'gym_owner', is_active: true });
  }

  logAudit({ action: 'gym_provisioned', table: 'gyms', actorId: actor.id, gymId: gym.id, recordId: gym.id, values: { name, slug, plan, ownerEmail: ownerEmail || null } });
  return { ok: true, error: null, message: `${name} provisioned at ${slug}.gymflow.ng.` };
}

'use server';

import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitName } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { DEFAULT_PLATFORM_COMMISSION_PCT } from '@/lib/paystack';

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
    .insert({ name, slug, city, subscription_plan: plan, status: 'active', platform_commission_pct: DEFAULT_PLATFORM_COMMISSION_PCT, trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString() })
    .select('id')
    .single();
  if (gymErr || !gym) return { ok: false, error: gymErr?.message ?? 'Could not create gym.' };

  // Owner account (optional): create the auth user + profile + owner staff link.
  if (ownerEmail) {
    // SECURITY: if the email already maps to an account, do NOT createUser again
    // (it errors) and do NOT rewrite that account's existing profile role/gym
    // (service-role write that would silently repoint an existing user into this
    // new gym as 'owner'). Only attach the owner staff link for a pre-existing
    // account; mint a profile only for a brand-new one.
    const { data: existing } = await admin.from('profiles').select('id, gym_id').eq('email', ownerEmail).maybeSingle();
    let uid: string | null = null;
    if (existing) {
      const existingGym = (existing as { gym_id: string | null }).gym_id;
      if (existingGym && existingGym !== gym.id) {
        return { ok: true, error: null, message: `${name} created, but ${ownerEmail} already belongs to another gym — link them manually.` };
      }
      uid = (existing as { id: string }).id;
    } else {
      const { data: created, error: authErr } = await admin.auth.admin.createUser({
        email: ownerEmail,
        email_confirm: true,
        user_metadata: { full_name: ownerName, gym_id: gym.id },
      });
      if (authErr || !created?.user) return { ok: true, error: null, message: `Gym created, but owner invite failed: ${authErr?.message ?? 'unknown error'}` };
      uid = created.user.id;
      // full_name is GENERATED in the live DB — write the split parts instead.
      await admin.from('profiles').upsert({ id: uid, email: ownerEmail, ...splitName(ownerName), role: 'owner', gym_id: gym.id });
    }
    if (uid) await admin.from('gym_staff_links').upsert({ user_id: uid, gym_id: gym.id, role: 'gym_owner', is_active: true }, { onConflict: 'user_id,gym_id' });
  }

  logAudit({ action: 'gym_provisioned', table: 'gyms', actorId: actor.id, gymId: gym.id, recordId: gym.id, values: { name, slug, plan, ownerEmail: ownerEmail || null } });
  return { ok: true, error: null, message: `${name} provisioned at ${slug}.gymflow.ng.` };
}

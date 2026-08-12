'use server';

import { randomBytes } from 'node:crypto';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitName } from '@/lib/format';
import { validatePassword } from '@/lib/auth/password';
import { logAudit } from '@/lib/audit';
import { DEFAULT_PLATFORM_COMMISSION_PCT } from '@/lib/paystack';
import { isPlanTier } from '@/lib/platform-plans';
import { gymUrl } from '@/lib/email/brand';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { ownerGymProvisioned } from '@/lib/email/templates/platform';

// tempPassword/email ride back in the state for the same reason admin-staff.ts
// returns them: the superadmin needs a credential to relay by hand when the
// mail bounces, or when RESEND_API_KEY isn't set at all.
export type OnboardState = { ok: boolean; error: string | null; message?: string; tempPassword?: string; email?: string };

// A brand-new owner account needs a password it can actually sign in with, and
// one the app's own reset form would accept: 18 random bytes is 144 bits of
// entropy, but a raw base64url draw can legitimately contain no digit or no
// symbol, which validatePassword rejects. Draw until the policy passes, then
// fall back to a suffix that pins the four character classes.
function tempPassword(): string {
  for (let i = 0; i < 8; i++) {
    const candidate = randomBytes(18).toString('base64url');
    if (!validatePassword(candidate)) return candidate;
  }
  return `${randomBytes(18).toString('base64url')}-Aa1`;
}

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
  // Checked here rather than left to the gyms_subscription_plan_valid check
  // constraint, which would surface as a raw Postgres error to the operator.
  const plan = String(formData.get('plan') ?? 'starter').trim();
  if (!isPlanTier(plan)) return { ok: false, error: 'Unknown plan.' };
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
  // `pwd` is set only for a brand-new account — an existing one keeps the
  // password its owner already knows, and must never be handed a new one from
  // here.
  let pwd: string | undefined;
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
      // A password is not optional here. createUser without one mints an
      // account with no credential at all: the owner we just "provisioned"
      // could never sign in, and nothing told them the gym existed.
      pwd = tempPassword();
      const { data: created, error: authErr } = await admin.auth.admin.createUser({
        email: ownerEmail,
        password: pwd,
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

  // Mail the credentials. Best-effort: the gym and the account exist either
  // way, and `mailed` only decides which half of the message the superadmin
  // reads — the password comes back in the state regardless.
  let mailed = false;
  if (pwd) {
    try {
      const res = await sendPlatformEmail({
        to: ownerEmail,
        ...ownerGymProvisioned({
          ownerName,
          gymName: name,
          email: ownerEmail,
          tempPassword: pwd,
          signInUrl: platformAppUrl('/login'),
          gymUrl: gymUrl(slug),
        }),
        template: 'owner_gym_provisioned',
      });
      mailed = res.ok;
    } catch { /* the temp password is still on screen */ }
  }

  return {
    ok: true,
    error: null,
    message: pwd
      ? `${name} provisioned at ${slug}.gymflow.ng. ${mailed ? `Sign-in details emailed to ${ownerEmail}.` : 'Email didn’t go out — share the sign-in details below.'}`
      : `${name} provisioned at ${slug}.gymflow.ng.`,
    tempPassword: pwd,
    email: pwd ? ownerEmail : undefined,
  };
}

import { createAdminClient } from '@/lib/supabase/admin';
import { getPlatformSettings, trialEndsAt } from '@/lib/platform-settings';
import { splitName, fmtDate } from '@/lib/format';
import { gymUrl } from '@/lib/email/brand';
import { sendPlatformEmail, platformAppUrl } from '@/lib/email/send';
import { ownerWelcome } from '@/lib/email/templates/platform';

export type ProvisionResult = { ok: boolean; error?: string };

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'gym';
}

// Provision a self-signup gym owner: gym row + profile + owner staff link.
// Idempotent — safe to call again for a user who is already set up (returns ok
// without touching anything), so it serves both the signup action and the
// /launch self-heal for accounts that signed up before provisioning existed.
// Service-role: profiles/gyms/gym_staff_links inserts are RLS-locked and the
// signup session (if any) has no privileges yet.
export async function provisionOwner(params: { userId: string; email: string; gymName: string; fullName?: string | null }): Promise<ProvisionResult> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // Already provisioned? (Retry after a partial failure, double-submit, or the
  // /launch heal racing the signup action.)
  const { data: existing } = await admin
    .from('gym_staff_links').select('id').eq('user_id', params.userId).eq('is_active', true).limit(1).maybeSingle();
  if (existing) return { ok: true };

  // Unique slug: name, name-2 … name-6, then a random suffix as last resort.
  const base = slugify(params.gymName);
  let gymId: string | null = null;
  // The slug the insert actually won, not `base`: collisions push the gym onto
  // name-2 … and the welcome mail must point at the address that exists.
  let gymSlug = base;
  let lastErr = '';
  // New gyms are 'active' (the value the gyms_status_check constraint accepts and
  // the rest of the app treats as live). The trial lives in trial_ends_at, not
  // in status. The slug list falls back name → name-2…name-6 → random suffix.
  //
  // Length and commission come from the platform settings row rather than being
  // hardcoded here, so this path and the /superadmin/onboard path can't disagree
  // about what a new gym starts on — they did: this one never set a commission
  // at all and took the column default, the other set the code constant.
  const defaults = await getPlatformSettings(admin);
  const trialEnds = trialEndsAt(defaults.defaultTrialDays);
  const candidates = [base, ...Array.from({ length: 5 }, (_, i) => `${base}-${i + 2}`), `${base}-${Math.random().toString(36).slice(2, 6)}`];
  for (const slug of candidates) {
    const { data, error } = await admin
      .from('gyms')
      .insert({ name: params.gymName, slug, status: 'active', subscription_plan: 'starter', platform_commission_pct: defaults.defaultCommissionPct, trial_ends_at: trialEnds })
      .select('id')
      .maybeSingle();
    if (data) { gymId = data.id; gymSlug = slug; break; }
    lastErr = error?.message ?? 'gym insert failed';
    // Anything other than a slug collision won't be fixed by another candidate.
    if (!/duplicate|unique/i.test(lastErr)) break;
  }
  if (!gymId) return { ok: false, error: lastErr };

  // full_name is GENERATED (first_name || ' ' || last_name) in the live DB —
  // writing it errors. Write the split parts; the DB derives full_name.
  const { error: profErr } = await admin
    .from('profiles')
    .upsert({ id: params.userId, email: params.email, ...splitName(params.fullName), role: 'owner', gym_id: gymId });
  if (profErr) return { ok: false, error: profErr.message };

  const { error: linkErr } = await admin
    .from('gym_staff_links')
    .insert({ user_id: params.userId, gym_id: gymId, role: 'gym_owner', is_active: true });
  if (linkErr) return { ok: false, error: linkErr.message };

  // Welcome mail. Best-effort and last: this function is idempotent and the
  // early return above means it only reaches here on the one run that actually
  // created the gym, so the owner gets exactly one — and a Resend failure must
  // not report a gym that exists as un-provisioned.
  try {
    await sendPlatformEmail({
      to: params.email,
      ...ownerWelcome({
        ownerName: params.fullName,
        gymName: params.gymName,
        gymUrl: gymUrl(gymSlug),
        adminUrl: platformAppUrl('/admin'),
        trialEndDate: fmtDate(trialEnds),
      }),
      template: 'owner_welcome',
    });
  } catch { /* the gym is live either way */ }

  return { ok: true };
}

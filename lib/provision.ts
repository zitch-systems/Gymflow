import { createAdminClient } from '@/lib/supabase/admin';

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
  let lastErr = '';
  const candidates = [base, ...Array.from({ length: 5 }, (_, i) => `${base}-${i + 2}`), `${base}-${Math.random().toString(36).slice(2, 6)}`];
  for (const slug of candidates) {
    const { data, error } = await admin
      .from('gyms')
      .insert({ name: params.gymName, slug, status: 'trial', subscription_plan: 'starter' })
      .select('id')
      .maybeSingle();
    if (data) { gymId = data.id; break; }
    lastErr = error?.message ?? 'gym insert failed';
    // Anything other than a slug collision won't be fixed by another candidate.
    if (!/duplicate|unique/i.test(lastErr)) break;
  }
  if (!gymId) return { ok: false, error: lastErr };

  const { error: profErr } = await admin
    .from('profiles')
    .upsert({ id: params.userId, email: params.email, full_name: params.fullName ?? null, role: 'owner', gym_id: gymId });
  if (profErr) return { ok: false, error: profErr.message };

  const { error: linkErr } = await admin
    .from('gym_staff_links')
    .insert({ user_id: params.userId, gym_id: gymId, role: 'gym_owner', is_active: true });
  if (linkErr) return { ok: false, error: linkErr.message };

  return { ok: true };
}

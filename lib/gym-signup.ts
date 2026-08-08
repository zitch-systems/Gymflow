import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitName } from '@/lib/format';
import { OFFLINE_GYM_FILTER } from '@/lib/gym-status';
import type { Database } from '@/lib/database.types';

// Shared gym sign-up helpers used by both the web /join flow and the native
// mobile app's /api/app/* endpoints. Kept server-only — every path here needs
// the service role (a joining user has no privileges on the gym yet).

export type PublicGym = {
  id: string; name: string; slug: string;
  brand_color: string | null; logo_url: string | null; member_code: string;
};

const PUBLIC_GYM_COLS = 'id, name, slug, brand_color, logo_url, member_code';

// Normalise a user-typed code: uppercase, strip anything outside the code
// alphabet (spaces, dashes, ambiguous look-alikes the user might substitute).
export function normalizeMemberCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

// A Supabase client that does auth WITHOUT cookies and returns the session in
// the response body — for native apps (no browser cookie jar). Uses the anon
// key; the caller still needs valid credentials.
export function createApiAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase is not configured.');
  return createSupabaseClient<Database>(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Both resolvers exclude gyms the platform has switched off. These two
// functions are the only way the mobile API turns a member code into a gym, so
// this filter is what stops /api/app/signup minting a brand-new auto-confirmed
// account into a suspended tenant — a path the older "hide the console" style
// of suspension left wide open, and one that no password rotation can close
// because the attacker never needs an existing account.
export async function resolveGymByCode(code: string): Promise<PublicGym | null> {
  const normalized = normalizeMemberCode(code);
  if (!normalized) return null;
  const admin = createAdminClient();
  const { data } = await admin.from('gyms')
    .select(PUBLIC_GYM_COLS)
    .eq('member_code', normalized)
    .not('status', 'in', OFFLINE_GYM_FILTER)
    .maybeSingle();
  return (data as PublicGym | null) ?? null;
}

export async function resolveGymBySlug(slug: string): Promise<PublicGym | null> {
  const admin = createAdminClient();
  const { data } = await admin.from('gyms')
    .select(PUBLIC_GYM_COLS)
    .eq('slug', slug)
    .not('status', 'in', OFFLINE_GYM_FILTER)
    .maybeSingle();
  return (data as PublicGym | null) ?? null;
}

// Link an auth user to a gym as a member (idempotent). Never demotes an
// existing profile's role — staff joining another gym as a member keep theirs.
export async function provisionMember(params: {
  userId: string; email: string; gymId: string; fullName?: string | null; phone?: string | null;
  onboardingMethod?: string;
}): Promise<{ ok: boolean; error?: string }> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const { data: existingLink } = await admin
    .from('gym_member_links').select('id').eq('user_id', params.userId).eq('gym_id', params.gymId).limit(1).maybeSingle();
  if (existingLink) return { ok: true };

  const { data: profile } = await admin.from('profiles').select('id, phone').eq('id', params.userId).maybeSingle();
  if (!profile) {
    // full_name is GENERATED in the live DB — write first/last, never full_name.
    const { error } = await admin.from('profiles').insert({
      id: params.userId, email: params.email, ...splitName(params.fullName), phone: params.phone ?? null, role: 'member', gym_id: params.gymId,
    });
    if (error) return { ok: false, error: error.message };
  } else if (params.phone && !(profile as { phone?: string | null }).phone) {
    await admin.from('profiles').update({ phone: params.phone }).eq('id', params.userId);
  }

  const { error: linkErr } = await admin.from('gym_member_links').insert({
    user_id: params.userId, member_id: params.userId, gym_id: params.gymId,
    is_active: true, status: 'active', onboarding_method: params.onboardingMethod ?? 'mobile_app', joined_at: new Date().toISOString(),
  });
  if (linkErr) return { ok: false, error: linkErr.message };
  return { ok: true };
}

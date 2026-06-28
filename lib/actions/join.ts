'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitName } from '@/lib/format';
import { validatePassword } from '@/lib/auth/password';

export type JoinState = { error: string | null };

// Link an auth user to a gym as a member (idempotent). Service-role: the
// joining user has no privileges on the gym yet. Never demotes an existing
// profile's role — staff joining another gym as a member keep their role.
async function provisionMember(params: { userId: string; email: string; gymId: string; fullName?: string | null }): Promise<{ ok: boolean; error?: string }> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const { data: existing } = await admin
    .from('gym_member_links').select('id').eq('user_id', params.userId).eq('gym_id', params.gymId).limit(1).maybeSingle();
  if (existing) return { ok: true };

  const { data: profile } = await admin.from('profiles').select('id').eq('id', params.userId).maybeSingle();
  if (!profile) {
    // full_name is GENERATED in the live DB — write first/last, never full_name.
    const { error } = await admin.from('profiles').insert({
      id: params.userId, email: params.email, ...splitName(params.fullName), role: 'member', gym_id: params.gymId,
    });
    if (error) return { ok: false, error: error.message };
  }

  const { error: linkErr } = await admin.from('gym_member_links').insert({
    user_id: params.userId, member_id: params.userId, gym_id: params.gymId,
    is_active: true, status: 'active', onboarding_method: 'join_link', joined_at: new Date().toISOString(),
  });
  if (linkErr) return { ok: false, error: linkErr.message };
  return { ok: true };
}

async function gymBySlug(slug: string): Promise<{ id: string; name: string } | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('gyms').select('id, name').eq('slug', slug).maybeSingle();
    return data ?? null;
  } catch {
    // No service key (preview env) — gyms are publicly readable, fall back.
    const supabase = await createClient();
    const { data } = await supabase.from('gyms').select('id, name').eq('slug', slug).maybeSingle();
    return data ?? null;
  }
}

// New member: create the auth account, confirm + sign in (same no-email-
// dependency flow as gym signup), link to the gym, land on /dashboard.
export async function joinAsNew(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const slug = String(formData.get('slug') ?? '').trim();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!slug) return { error: 'Missing gym link — ask your gym for a fresh invite.' };
  if (!fullName) return { error: 'Enter your name.' };
  if (!email || !password) return { error: 'Enter your email and password.' };
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };

  const gym = await gymBySlug(slug);
  if (!gym) return { error: 'This invite link isn’t valid — ask your gym for a fresh one.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/login?confirmed=1`,
      data: { full_name: fullName, join_gym_slug: slug },
    },
  });
  if (error) return { error: error.message };
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { error: 'An account with this email already exists. Sign in, then open this invite link again to join.' };
  }
  if (!data.user) return { error: 'Could not create the account. Please try again.' };

  let session = data.session;
  if (!session) {
    try {
      const admin = createAdminClient();
      const { error: confirmErr } = await admin.auth.admin.updateUserById(data.user.id, { email_confirm: true });
      if (!confirmErr) {
        const { data: signed, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!signErr) session = signed.session;
      }
    } catch { /* no service key — email-confirmation path */ }
  }

  const prov = await provisionMember({ userId: data.user.id, email, gymId: gym.id, fullName });
  if (!prov.ok) console.error(`[join] provisioning failed for ${data.user.id}: ${prov.error}`); // /launch self-heals via join_gym_slug

  if (session) redirect('/dashboard');
  redirect('/login?check-email=1');
}

// Already signed in: link the current account to this gym as a member.
export async function joinAsCurrent(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const slug = String(formData.get('slug') ?? '').trim();
  if (!slug) return { error: 'Missing gym link — ask your gym for a fresh invite.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/join/${encodeURIComponent(slug)}`);

  const gym = await gymBySlug(slug);
  if (!gym) return { error: 'This invite link isn’t valid — ask your gym for a fresh one.' };

  const prov = await provisionMember({ userId: user.id, email: user.email ?? '', gymId: gym.id });
  if (!prov.ok) return { error: prov.error ?? 'Could not join. Please try again.' };
  redirect('/launch');
}

// Shared with /launch's self-heal for accounts whose join provisioning failed.
export async function healJoin(userId: string, email: string, slug: string): Promise<boolean> {
  const gym = await gymBySlug(slug);
  if (!gym) return false;
  const prov = await provisionMember({ userId, email, gymId: gym.id });
  return prov.ok;
}

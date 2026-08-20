'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitName, normalizeNgPhone, firstName } from '@/lib/format';
import { validatePassword } from '@/lib/auth/password';
import { GYM_EMAIL_COLUMNS, type EmailGym } from '@/lib/email/recipients';
import { memberAppUrl, sendGymEmail } from '@/lib/email/send';
import { MEMBER_TEMPLATES, welcome } from '@/lib/email/templates/member';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { OFFLINE_GYM_FILTER } from '@/lib/gym-status';

export type JoinState = { error: string | null };

/** The gym as the join flow needs it: enough to link a member, plus everything
 *  the welcome mail is dressed in. member_code isn't in GYM_EMAIL_COLUMNS — it's
 *  the code a member types to find their gym from a fresh app install. */
type JoinGym = EmailGym & { member_code: string | null };

// Link an auth user to a gym as a member (idempotent). Service-role: the
// joining user has no privileges on the gym yet. Never demotes an existing
// profile's role — staff joining another gym as a member keep their role.
// `created` distinguishes "linked just now" from "was already a member here":
// this function is idempotent by design (it also backs /launch's self-heal), so
// without it re-opening a join link mails the welcome again to someone who has
// been training there for a year.
async function provisionMember(params: { userId: string; email: string; gymId: string; fullName?: string | null; phone?: string | null }): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const { data: existing } = await admin
    .from('gym_member_links').select('id').eq('user_id', params.userId).eq('gym_id', params.gymId).limit(1).maybeSingle();
  if (existing) return { ok: true, created: false };

  const { data: profile } = await admin.from('profiles').select('id, phone').eq('id', params.userId).maybeSingle();
  if (!profile) {
    // full_name is GENERATED in the live DB — write first/last, never full_name.
    const { error } = await admin.from('profiles').insert({
      id: params.userId, email: params.email, ...splitName(params.fullName), phone: params.phone ?? null, role: 'member', gym_id: params.gymId,
    });
    if (error) return { ok: false, error: error.message };
  } else if (params.phone && !(profile as { phone?: string | null }).phone) {
    // Existing profile with no phone on file (e.g. a prior partial signup) — backfill it.
    await admin.from('profiles').update({ phone: params.phone }).eq('id', params.userId);
  }

  const { error: linkErr } = await admin.from('gym_member_links').insert({
    user_id: params.userId, member_id: params.userId, gym_id: params.gymId,
    is_active: true, status: 'active', onboarding_method: 'join_link', joined_at: new Date().toISOString(),
  });
  if (linkErr) return { ok: false, error: linkErr.message };
  return { ok: true, created: true };
}

// Both join paths end in a welcome email dressed in the gym's own logo, colour
// and subdomain, so this reads the branding columns in the lookup the flow was
// doing anyway — a second round-trip on the join path buys nothing.
const JOIN_GYM_COLUMNS = `${GYM_EMAIL_COLUMNS}, member_code`;

// Resolving to null for an offline gym is what stops the join: every caller
// (joinAsNew, joinAsCurrent, healJoin) already treats a missing gym as "no such
// gym". Without the filter a suspended tenant kept acquiring members — a real
// auth account, an active gym_member_links row and a gym-branded welcome email
// pointing at a subdomain the platform had taken down.
async function gymBySlug(slug: string): Promise<JoinGym | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('gyms').select(JOIN_GYM_COLUMNS).eq('slug', slug)
      .not('status', 'in', OFFLINE_GYM_FILTER).maybeSingle();
    return (data as unknown as JoinGym | null) ?? null;
  } catch {
    // No service key (preview env) — gyms are publicly readable, fall back.
    const supabase = await createClient();
    const { data } = await supabase.from('gyms').select(JOIN_GYM_COLUMNS).eq('slug', slug)
      .not('status', 'in', OFFLINE_GYM_FILTER).maybeSingle();
    return (data as unknown as JoinGym | null) ?? null;
  }
}

/**
 * The welcome both join paths send.
 *
 * Same template as a front-desk addition (lib/actions/admin-member.ts), minus
 * the set-a-password link: someone who signed themselves up chose their own
 * password on the way in. Best-effort and last in the action — the membership
 * link is already written, and joining must not fail because Resend did.
 */
async function sendJoinWelcome(gym: JoinGym, to: { email: string; fullName: string | null }): Promise<void> {
  if (!to.email) return;
  try {
    const spec = MEMBER_TEMPLATES.welcome;
    await sendGymEmail({
      gym, to, template: spec.template, category: spec.category,
      ...welcome({
        gymName: (gym.name ?? '').trim() || 'Your gym',
        firstName: firstName(to.fullName),
        dashboardUrl: memberAppUrl(gym),
        memberCode: gym.member_code,
      }),
    });
  } catch { /* bonus channel */ }
}

// New member: create the auth account, confirm + sign in (same no-email-
// dependency flow as gym signup), link to the gym, land on /dashboard.
export async function joinAsNew(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const slug = String(formData.get('slug') ?? '').trim();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const phone = normalizeNgPhone(String(formData.get('phone') ?? ''));
  if (!slug) return { error: 'Missing gym link — ask your gym for a fresh invite.' };
  if (!fullName) return { error: 'Enter your name.' };
  if (!phone) return { error: 'Enter a valid phone number (e.g. 080 1234 5678).' };
  if (!email || !password) return { error: 'Enter your email and password.' };
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };

  // Public account creation must not bypass the anti-abuse controls on the
  // owner signup flow. Run these before touching Auth so a blocked request
  // creates neither a user nor a confirmation email.
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`member-join:ip:${ip}`, 5, 3600),
    rateLimit(`member-join:email:${email.toLowerCase()}`, 3, 3600),
  ]);
  if (!ipOk || !emailOk) {
    return { error: 'Too many join attempts. Please wait an hour and try again.' };
  }

  const gym = await gymBySlug(slug);
  if (!gym) return { error: 'This invite link isn’t valid — ask your gym for a fresh one.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/auth/confirm?next=/launch`,
      data: { full_name: fullName, phone, join_gym_slug: slug },
    },
  });
  if (error) return { error: error.message };
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { error: 'An account with this email already exists. Sign in, then open this invite link again to join.' };
  }
  if (!data.user) return { error: 'Could not create the account. Please try again.' };

  // Never service-role-confirm a public signup. Without this boundary, anyone
  // can create and immediately control an account for an email address they do
  // not own. The confirmation callback establishes the session, and /launch
  // provisions the member from the signed user_metadata breadcrumb above.
  if (!data.session) redirect('/login?check-email=1');

  // Confirmations can be disabled in local/preview environments. If Auth
  // legitimately returned a session, preserve that supported path and link the
  // member immediately.
  const prov = await provisionMember({ userId: data.user.id, email, gymId: gym.id, fullName, phone });
  if (!prov.ok) {
    console.error(`[join] provisioning failed for ${data.user.id}: ${prov.error}`);
    redirect('/launch'); // self-heals via join_gym_slug
  }

  // Name and address both came off the form, so there's nothing to look up.
  // Must run before the redirect below — redirect() throws to unwind.
  if (prov.created) await sendJoinWelcome(gym, { email, fullName });
  redirect('/dashboard');
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

  // Reading the profile just to greet them by name isn't worth a round-trip when
  // email is switched off — or when they were already a member here.
  if (prov.created && process.env.RESEND_API_KEY) {
    const { data: profile } = await supabase.from('profiles').select('email, full_name').eq('id', user.id).maybeSingle();
    await sendJoinWelcome(gym, {
      email: (profile?.email ?? user.email ?? '').trim(),
      fullName: profile?.full_name ?? null,
    });
  }
  redirect('/launch');
}

// /launch's self-heal for an authenticated account whose join provisioning
// failed: re-link the CURRENT user to the gym recorded in their own signup
// metadata. Every export of a 'use server' module is a callable POST endpoint,
// so this trusts only the session — never a caller-supplied identity. An
// earlier version took (userId, email, slug, phone) as arguments and did
// service-role writes with them, which let an unauthenticated request enrol an
// arbitrary user id into any (public) gym slug. All identity now comes from
// getUser(); slug/phone come from that user's own metadata.
export async function healJoin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const meta = (user.user_metadata as Record<string, unknown> | null) ?? {};
  const slug = String(meta.join_gym_slug ?? '').trim();
  if (!slug) return false;

  const gym = await gymBySlug(slug);
  if (!gym) return false;

  const phone = meta.phone != null ? String(meta.phone) : null;
  const prov = await provisionMember({
    userId: user.id, email: user.email ?? '', gymId: gym.id, phone: normalizeNgPhone(phone),
  });
  return prov.ok;
}

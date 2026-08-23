import { createApiAuthClient, resolveGymByCode, provisionMember } from '@/lib/gym-signup';
import { validatePassword } from '@/lib/auth/password';
import { normalizeNgPhone } from '@/lib/format';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { json, corsPreflight, sessionPayload, planLocked } from '@/lib/api-app';
import { gymCanUse } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// POST /api/app/signup — native app member sign-up, scoped to a gym code.
// Body: { code, email, password, full_name, phone? }. Creates the auth account,
// confirms + signs in (no dependence on email delivery, mirroring the web join
// flow), links the member to the gym, and returns the Supabase session so the
// app is immediately logged in.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const code = String(body.code ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const fullName = String(body.full_name ?? '').trim();
  const phone = normalizeNgPhone(String(body.phone ?? ''));

  if (!code) return json({ error: 'Enter your gym code.' }, 400);
  if (!fullName) return json({ error: 'Enter your name.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  const pwErr = validatePassword(password);
  if (pwErr) return json({ error: pwErr }, 400);

  // Throttle: this endpoint auto-confirms accounts via the service role, so it's
  // abuse-prone — cap per IP and per target email, like the web signup.
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`app-signup:ip:${ip}`, 8, 3600),
    rateLimit(`app-signup:email:${email}`, 4, 3600),
  ]);
  if (!ipOk || !emailOk) return json({ error: 'Too many sign-up attempts. Please wait an hour and try again.' }, 429);

  try {
    const gym = await resolveGymByCode(code);
    if (!gym) return json({ error: 'No gym found for that code. Check it with your gym.' }, 404);

    // Same gate as sign-in, and for the same reason it sits above the account
    // creation rather than below it: a gym whose plan doesn't include the member
    // app shouldn't gain an auto-confirmed auth account and a membership row out
    // of a door its members can't walk through.
    if (!gymCanUse(gym, 'member_app')) return planLocked(gym.name, 'the member app');

    const auth = createApiAuthClient();
    const { data, error } = await auth.auth.signUp({
      email, password, options: { data: { full_name: fullName, phone } },
    });
    if (error) return json({ error: error.message }, 400);
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return json({ error: 'An account with this email already exists. Sign in instead.' }, 409);
    }
    if (!data.user) return json({ error: 'Could not create the account. Please try again.' }, 400);

    // Never service-role-confirm a public signup. The web /join flow observes
    // this boundary (lib/actions/join.ts:150) — without it, anyone could mint
    // and immediately control an account for an email they don't own. Same
    // rule here: return whatever session the Auth server chose to issue (none,
    // in the confirmations-required default), and let the confirmation link
    // wake the account.
    const session = data.session;

    // Provisioning is safe to run before confirmation: it links the auth user
    // (which now exists) to the gym so the confirmation → /launch handoff
    // finds the member row already in place. The account still can't reach
    // the app until the email is confirmed.
    const prov = await provisionMember({ userId: data.user.id, email, gymId: gym.id, fullName, phone, onboardingMethod: 'mobile_app' });
    if (!prov.ok) return json({ error: prov.error ?? 'Could not join the gym. Please try again.' }, 500);

    return json({
      gym: { id: gym.id, name: gym.name, slug: gym.slug, brand_color: gym.brand_color, logo_url: gym.logo_url },
      user: { id: data.user.id, email, full_name: fullName },
      session: sessionPayload(session),
      needs_email_confirmation: !session,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

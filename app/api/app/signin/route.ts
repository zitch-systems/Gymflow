import { createApiAuthClient, resolveGymByCode, provisionMember } from '@/lib/gym-signup';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { json, corsPreflight, sessionPayload } from '@/lib/api-app';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// POST /api/app/signin — native app member sign-in, scoped to a gym code.
// Body: { code, email, password }. Signs in via Supabase, ensures the member is
// linked to the gym for that code (idempotent — joins them if not already, the
// same trust model as the web /join link), and returns the Supabase session.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const code = String(body.code ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!code) return json({ error: 'Enter your gym code.' }, 400);
  if (!EMAIL_RE.test(email) || !password) return json({ error: 'Enter your email and password.' }, 400);

  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    rateLimit(`app-signin:ip:${ip}`, 30, 900),
    rateLimit(`app-signin:email:${email}`, 10, 900),
  ]);
  if (!ipOk || !emailOk) return json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' }, 429);

  try {
    const gym = await resolveGymByCode(code);
    if (!gym) return json({ error: 'No gym found for that code. Check it with your gym.' }, 404);

    const auth = createApiAuthClient();
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) return json({ error: 'Wrong email or password.' }, 401);

    // Ensure a membership at this gym (idempotent — no-op if already linked).
    const prov = await provisionMember({ userId: data.user.id, email, gymId: gym.id, onboardingMethod: 'mobile_app' });
    if (!prov.ok) return json({ error: prov.error ?? 'Signed in, but couldn’t attach your gym. Please try again.' }, 500);

    return json({
      gym: { id: gym.id, name: gym.name, slug: gym.slug, brand_color: gym.brand_color, logo_url: gym.logo_url },
      user: { id: data.user.id, email: data.user.email ?? email },
      session: sessionPayload(data.session),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

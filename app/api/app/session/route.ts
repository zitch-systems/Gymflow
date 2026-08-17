import { createApiAuthClient } from '@/lib/gym-signup';
import { json, corsPreflight, readJson, sessionPayload } from '@/lib/api-app';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

// POST /api/app/session — { refresh_token } → a fresh session.
//
// Supabase access tokens are short-lived, and the app holds the refresh token in
// the device keystore rather than persisting a Supabase client, so the exchange
// happens here. No bearer auth: the refresh token IS the credential, and by
// definition the access token it replaces has expired.
export async function POST(req: Request) {
  const body = await readJson(req);
  const refreshToken = String(body.refresh_token ?? '').trim();
  if (!refreshToken) return json({ error: 'Missing refresh token.' }, 400);

  // A refresh token is a bearer credential, so a stolen-token holder shouldn't
  // get an unlimited mint rate. Generous enough for a normal device (one
  // refresh per hour, plus cold starts and retries).
  const ip = await clientIp();
  if (!(await rateLimit(`app-refresh:ip:${ip}`, 60, 900))) {
    return json({ error: 'Too many attempts. Please wait a moment.' }, 429);
  }

  try {
    const auth = createApiAuthClient();
    const { data, error } = await auth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      // 401 rather than 400: this is the app's signal to drop the stored
      // session and send the member back to sign-in.
      return json({ error: 'Your session has expired. Please sign in again.', code: 'expired' }, 401);
    }
    return json({
      session: sessionPayload(data.session),
      user: data.user ? { id: data.user.id, email: data.user.email ?? null } : null,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

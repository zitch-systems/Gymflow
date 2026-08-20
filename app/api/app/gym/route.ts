import { resolveGymByCode } from '@/lib/gym-signup';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { json, corsPreflight } from '@/lib/api-app';
import { gymCanUse } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

// GET /api/app/gym?code=ABC123 — resolve a gym from its member code. Public: the
// native app calls this after the user enters their gym code, to validate it and
// show the gym's name/branding before sign-in. Returns only public fields.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  if (!code.trim()) return json({ error: 'Enter your gym code.' }, 400);

  // Its neighbours (signin, signup) throttle per IP because a member code is a
  // short string an unauthenticated caller can guess at. This endpoint is the
  // cheapest way to test one — it takes nothing but the code — so leaving it
  // unlimited made the throttles on the other two beside the point. Same
  // window, looser cap: a real app hits this once per typed code, but a member
  // retyping a code they got wrong must not lock themselves out of sign-in.
  const ip = await clientIp();
  if (!await rateLimit(`app-gym:ip:${ip}`, 60, 900)) {
    return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429);
  }

  try {
    const gym = await resolveGymByCode(code);
    // A gym whose plan doesn't include the member app is answered exactly as an
    // unknown code is, deliberately: this endpoint has no caller identity at
    // all, so a distinguishable refusal would publish "which gyms pay GymFlow
    // for what" — with the gym's own name attached — to anyone holding a member
    // code. The app can't act on the difference either way (there is no
    // sign-in behind it to reach), and the gym's own members hear the real
    // reason from the front desk, not from a code box. Sign-in and sign-up
    // still refuse independently; this endpoint is a convenience, not the
    // boundary.
    if (!gym || !gymCanUse(gym, 'member_app')) {
      return json({ error: 'No gym found for that code. Check it with your gym.' }, 404);
    }
    return json({
      gym: { id: gym.id, name: gym.name, slug: gym.slug, brand_color: gym.brand_color, logo_url: gym.logo_url, member_code: gym.member_code },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

import { resolveGymByCode } from '@/lib/gym-signup';
import { json, corsPreflight, planLocked } from '@/lib/api-app';
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
  try {
    const gym = await resolveGymByCode(code);
    if (!gym) return json({ error: 'No gym found for that code. Check it with your gym.' }, 404);
    // Step one of the app's sign-in flow, so it's where the plan gate reads
    // best: a gym whose plan doesn't include the member app is not a gym this
    // app can sign anyone into, and saying so at the code beats saying it after
    // the member has typed a password. Sign-in and sign-up refuse independently
    // — this endpoint is a convenience, not the boundary.
    if (!gymCanUse(gym, 'member_app')) return planLocked(gym.name, 'the member app');
    return json({
      gym: { id: gym.id, name: gym.name, slug: gym.slug, brand_color: gym.brand_color, logo_url: gym.logo_url, member_code: gym.member_code },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

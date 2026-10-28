import { requireApiMember, json, corsPreflight, readJson, dataUnavailable } from '@/lib/api-app';
import { memberMembershipState, requestMemberFreeze } from '@/lib/member-freeze-core';
import { disableMemberSubscription } from '@/lib/member-billing-core';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function OPTIONS() { return corsPreflight(); }

export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;
  try { return json(await memberMembershipState(supabase, user.id, gym)); }
  catch { return dataUnavailable(); }
}

export async function POST(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;
  const body = await readJson(req);
  if (!['request_freeze', 'cancel_auto_renew'].includes(String(body.action))) return json({ error: 'Choose a valid membership action.' }, 400);
  if (!await rateLimit(`membership:user:${user.id}`, 10, 60)) return json({ error: 'Please wait a moment before trying again.' }, 429);
  try {
    if (body.action === 'cancel_auto_renew') {
      if (body.confirmed !== true || typeof body.subscription_id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.subscription_id)) {
        return json({ error: 'Confirm which membership should stop renewing automatically.' }, 400);
      }
      const result = await disableMemberSubscription(body.subscription_id, { userId: user.id, gymId: gym.id, role: 'member' });
      return json(result, result.ok ? 200 : 422);
    }
    const result = await requestMemberFreeze(supabase, user.id, gym, { start: body.start, end: body.end, reason: body.reason });
    return json(result, result.ok ? 200 : 422);
  } catch { return dataUnavailable(); }
}

import { requireApiMember, json, corsPreflight, readJson, dataUnavailable } from '@/lib/api-app';
import { acceptWaiver, getWaiverState, WaiverChangedError } from '@/lib/waiver-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function OPTIONS() { return corsPreflight(); }

export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;
  try {
    return json({ gym: { id: gym.id, name: gym.name }, ...await getWaiverState(supabase, user.id, gym) });
  } catch { return dataUnavailable(); }
}

export async function POST(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;
  const body = await readJson(req);
  if (body.accepted !== true || typeof body.gymId !== 'string'
      || typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision)) {
    return json({ error: 'Review the current waiver and explicitly accept it.', code: 'invalid_acceptance' }, 400);
  }
  try {
    const state = await acceptWaiver(supabase, user.id, gym, { gymId: body.gymId, revision: body.revision });
    return json({ gym: { id: gym.id, name: gym.name }, ...state });
  } catch (error) {
    if (error instanceof WaiverChangedError) return json({ error: error.message, code: error.code }, 409);
    return dataUnavailable();
  }
}

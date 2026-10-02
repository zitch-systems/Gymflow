import { corsPreflight, json, readJson } from '@/lib/api-app';
import { deletionPayload, getAccountDeletionRequest, requestAccountDeletion, requireAccountDeletionUser } from '@/lib/account-deletion';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export function OPTIONS() { return corsPreflight(); }

export async function GET(req: Request) {
  const auth = await requireAccountDeletionUser(req);
  if (!auth.ok) return auth.res;
  try {
    return json(deletionPayload(await getAccountDeletionRequest(auth.user.id)));
  } catch {
    return json({ error: 'We could not load your account deletion request. Please retry.' }, 503);
  }
}

export async function POST(req: Request) {
  const auth = await requireAccountDeletionUser(req);
  if (!auth.ok) return auth.res;
  const body = await readJson(req);
  if (body.confirmation !== 'DELETE' || Object.keys(body).some((key) => key !== 'confirmation')) {
    return json({ error: 'Confirm account deletion by entering DELETE. Do not include an account or gym identifier.' }, 400);
  }
  try {
    return json(deletionPayload(await requestAccountDeletion(auth.user.id)), 202);
  } catch {
    return json({ error: 'We could not save your account deletion request. Please retry.' }, 503);
  }
}

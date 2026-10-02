import 'server-only';
import type { User } from '@supabase/supabase-js';
import { authFailure, bearerToken, createTokenClient, json } from '@/lib/api-app';
import { createAdminClient } from '@/lib/supabase/admin';

export const ACCOUNT_DELETION_DAYS = 30;
export const ACCOUNT_DELETION_MESSAGE = 'Your request covers your whole GymFlow account, across all gyms. We aim to complete it within 30 days and will confirm completion. Your account stays available while we process the request. We will remove your account and associated personal data except records we are legally required to retain. Existing renewals continue until cancelled; processing includes stopping future renewals.';

export type AccountDeletionRequest = {
  id: string; status: 'pending' | 'processing' | 'completed';
  requested_at: string; due_at: string; completed_at: string | null;
};
export type AccountDeletionQueueRow = AccountDeletionRequest & { subject_id: string; updated_at: string };
const PUBLIC_COLUMNS = 'id, status, requested_at, due_at, completed_at';

/** Privacy rights are account-wide and never depend on a gym link or paid plan. */
export async function requireAccountDeletionUser(req: Request): Promise<
  { ok: true; user: User } | { ok: false; res: Response }
> {
  const token = bearerToken(req);
  if (!token) return { ok: false, res: json({ error: 'Sign in to continue.', code: 'no_token' }, 401) };
  try {
    const { data, error } = await createTokenClient(token).auth.getUser(token);
    if (error) return { ok: false, res: authFailure(error) };
    if (!data.user) return { ok: false, res: authFailure({ status: 401 }) };
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, res: authFailure(null) };
  }
}

export function deletionPayload(request: AccountDeletionRequest | null) {
  return {
    request: request ? {
      ...request,
      status_message: request.status === 'completed'
        ? 'The operator has confirmed that account deletion is complete and that completion confirmation was sent.'
        : request.status === 'processing'
          ? 'Your account deletion request is being processed.'
          : 'Your account deletion request has been received.',
    } : null,
    processing_days: ACCOUNT_DELETION_DAYS,
    message: ACCOUNT_DELETION_MESSAGE,
  };
}

// These helpers accept ONLY the id resolved from a verified Auth identity.
// The service role supplies a durable queue independently of tenant RLS.
export async function getAccountDeletionRequest(subjectId: string): Promise<AccountDeletionRequest | null> {
  const { data, error } = await createAdminClient().from('account_deletion_requests' as never)
    .select(PUBLIC_COLUMNS).eq('subject_id', subjectId).maybeSingle();
  if (error) throw new Error('We could not load your account deletion request. Please retry.');
  return data as unknown as AccountDeletionRequest | null;
}

export async function requestAccountDeletion(subjectId: string): Promise<AccountDeletionRequest> {
  const admin = createAdminClient();
  // Unique subject_id + ignoreDuplicates makes parallel taps/retries preserve
  // the original due date and processing state instead of resetting the queue.
  const { error } = await admin.from('account_deletion_requests' as never)
    .upsert({ subject_id: subjectId } as never, { onConflict: 'subject_id', ignoreDuplicates: true });
  if (error) throw new Error('We could not save your account deletion request. Please retry.');
  const request = await getAccountDeletionRequest(subjectId);
  if (!request) throw new Error('We could not confirm your account deletion request. Please retry.');
  return request;
}

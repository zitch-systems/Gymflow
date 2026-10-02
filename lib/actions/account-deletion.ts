'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { getUser, requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { createApiAuthClient } from '@/lib/gym-signup';
import { clientIp } from '@/lib/rate-limit';
import { getAccountDeletionRequest, requestAccountDeletion, type AccountDeletionRequest } from '@/lib/account-deletion';

export type DeletionState = { ok: boolean; error: string | null; request?: AccountDeletionRequest | null; message?: string };

async function credentialAttemptAllowed(key: string, maximum: number) {
  const { data, error } = await createAdminClient().rpc('rate_limit_hit', {
    p_key: key, p_max: maximum, p_window_seconds: 900,
  });
  if (error || typeof data !== 'boolean') throw new Error('Verification is unavailable.');
  return data;
}

/** No cookie/session is minted for this rights-only credential check. */
export async function submitAccountDeletion(_previous: DeletionState, formData: FormData): Promise<DeletionState> {
  const intent = String(formData.get('intent') ?? 'request');
  if (!['request', 'status'].includes(intent)) return { ok: false, error: 'Invalid request.' };
  if (intent === 'request' && formData.get('confirmation') !== 'DELETE') {
    return { ok: false, error: 'Enter DELETE to confirm deletion of your whole GymFlow account.' };
  }
  const mode = String(formData.get('mode') ?? '');
  if (!['session', 'credentials'].includes(mode)) return { ok: false, error: 'Reload this page and try again.' };
  let ephemeral: ReturnType<typeof createApiAuthClient> | undefined;
  try {
    let subjectId: string;
    if (mode === 'session') {
      const user = await getUser();
      if (!user) return { ok: false, error: 'Your session has expired. Reload this page to verify your account.' };
      subjectId = user.id;
    } else {
      const email = String(formData.get('email') ?? '').trim().toLowerCase();
      const password = String(formData.get('password') ?? '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254 || !password || password.length > 1024) {
        return { ok: false, error: 'Enter your email and password.' };
      }
      const ip = await clientIp();
      const allowed = await Promise.all([
        credentialAttemptAllowed(`account-deletion:ip:${ip}`, 30),
        credentialAttemptAllowed(`account-deletion:email:${createHash('sha256').update(email).digest('hex')}`, 10),
      ]);
      if (allowed.some((value) => !value)) return { ok: false, error: 'Too many attempts. Please wait a few minutes and retry.' };
      ephemeral = createApiAuthClient();
      const { data, error } = await ephemeral.auth.signInWithPassword({ email, password });
      if (error || !data.user || !data.session) return { ok: false, error: 'We could not verify that email and password.' };
      // This is only a deletion request/status receipt. Never return tokens,
      // set browser cookies, create a staff proof, or grant any app access.
      subjectId = data.user.id;
    }
    const request = intent === 'request'
      ? await requestAccountDeletion(subjectId)
      : await getAccountDeletionRequest(subjectId);
    revalidatePath('/account/delete');
    return { ok: true, error: null, request, message: request
      ? request.status === 'completed' ? 'Account deletion was marked complete.' : 'Your account deletion request is saved.'
      : 'There is no account deletion request for this account.' };
  } catch {
    return { ok: false, error: 'Account deletion requests are temporarily unavailable. Please retry.' };
  } finally {
    // Local scope revokes only the short-lived session created above. A staff
    // member's separate, fully verified browser session is never touched.
    if (ephemeral) {
      try { await ephemeral.auth.signOut({ scope: 'local' }); } catch { /* No token is ever disclosed. */ }
    }
  }
}

export async function reviewAccountDeletion(_previous: DeletionState, formData: FormData): Promise<DeletionState> {
  const actor = await requirePlatformAdmin();
  const requestId = String(formData.get('request_id') ?? '');
  const expected = String(formData.get('expected_status') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
    || !((expected === 'pending' && status === 'processing') || (expected === 'processing' && status === 'completed'))) {
    return { ok: false, error: 'Invalid request transition. Reload the queue.' };
  }
  const erased = formData.get('erasure_completed') === 'on';
  const confirmed = formData.get('confirmation_sent') === 'on';
  const reference = String(formData.get('completion_reference') ?? '').trim();
  const retention = String(formData.get('retention_summary') ?? '').trim();
  if (status === 'completed' && (!erased || !confirmed || reference.length < 5 || reference.length > 300 || retention.length < 5 || retention.length > 1000)) {
    return { ok: false, error: 'Confirm actual erasure and completion notification, and record the evidence reference and retention outcome.' };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('review_account_deletion_request' as never, {
      p_request_id: requestId, p_actor_id: actor.id, p_expected_status: expected, p_status: status,
      p_erasure_completed: erased, p_confirmation_sent: confirmed,
      p_completion_reference: reference || null, p_retention_summary: retention || null,
    } as never);
    if (error) return { ok: false, error: 'The request could not be updated. No completion has been recorded.' };
    if (data !== true) return { ok: false, error: 'This request changed while you were reviewing it. Reload the queue.' };
    revalidatePath('/superadmin/account-deletions');
    return { ok: true, error: null, message: 'Request status updated.' };
  } catch {
    return { ok: false, error: 'The request could not be updated. Please retry.' };
  }
}

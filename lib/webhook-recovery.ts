import 'server-only';
import { createHash, randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { processPaystackEvent, eventReference, type WebhookDispatchResult } from '@/lib/paystack-webhook';
import { redactOperationalText, retryDelaySeconds } from '@/lib/operational-core';
import { decryptWebhookPayload, encryptWebhookPayload } from '@/lib/webhook-payload';
import { verifyTransaction } from '@/lib/paystack';
import { captureServerEvent } from '@/lib/server-error';

type Admin = ReturnType<typeof createAdminClient>;
type Json = Record<string, unknown>;

export type WebhookJob = {
  body_hash: string;
  event_name: string;
  reference: string | null;
  source: 'webhook' | 'reconciliation';
  payload_ciphertext: string;
  attempts: number;
  lock_token: string;
};

export function reconciliationJobHash(reference: string): string {
  return createHash('sha256').update(`paystack:reconciliation:${reference}`).digest('hex');
}

export async function enqueuePaystackEvent(
  admin: Admin,
  input: { bodyHash: string; event: Json; source: 'webhook' | 'reconciliation' },
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const eventName = typeof input.event.event === 'string' ? input.event.event : 'unknown';
  const reference = eventReference(input.event);
  let payloadCiphertext: string;
  try { payloadCiphertext = encryptWebhookPayload(input.event); }
  catch { return { ok: false, error: 'Recovery encryption unavailable' }; }
  const { error } = await admin.from('payment_webhook_jobs' as never).upsert({
    body_hash: input.bodyHash,
    source: input.source,
    event_name: eventName,
    reference,
    payload_ciphertext: payloadCiphertext,
    verified_at: new Date().toISOString(),
    verification_method: input.source === 'webhook' ? 'paystack_hmac' : 'paystack_api',
  } as never, { onConflict: 'body_hash', ignoreDuplicates: true });
  if (error) return { ok: false, error: redactOperationalText(error.message) };
  const { data, error: readError } = await admin.from('payment_webhook_jobs' as never)
    .select('status').eq('body_hash', input.bodyHash).maybeSingle();
  if (readError || !data) return { ok: false, error: redactOperationalText(readError?.message ?? 'queued event could not be read') };
  return { ok: true, status: String((data as { status: string }).status) };
}

export async function enqueueReconciledCharges(admin: Admin, references: string[]): Promise<void> {
  if (references.length === 0) return;
  const verifiedAt = new Date().toISOString();
  const rows = references.map((reference) => ({
    body_hash: reconciliationJobHash(reference),
    source: 'reconciliation',
    event_name: 'charge.success',
    reference,
    payload_ciphertext: encryptWebhookPayload({ event: 'charge.success', data: { reference } }),
    verified_at: verifiedAt,
    verification_method: 'paystack_api',
  }));
  const { error } = await admin.from('payment_webhook_jobs' as never).upsert(rows as never, {
    onConflict: 'body_hash', ignoreDuplicates: true,
  });
  if (error) throw new Error(`could not queue missing charges: ${redactOperationalText(error.message)}`);
}

export async function claimPaystackEvents(
  admin: Admin,
  limit: number,
  bodyHash?: string,
): Promise<{ lockToken: string; jobs: WebhookJob[] }> {
  const lockToken = randomUUID();
  const { data, error } = await admin.rpc('claim_payment_webhook_jobs' as never, {
    p_limit: limit,
    p_lock_token: lockToken,
    p_body_hash: bodyHash ?? null,
  } as never);
  if (error) throw new Error(`could not claim Paystack recovery work: ${redactOperationalText(error.message)}`);
  return { lockToken, jobs: (data ?? []) as unknown as WebhookJob[] };
}

export async function finishPaystackEvent(
  admin: Admin,
  job: WebhookJob,
  result: WebhookDispatchResult,
): Promise<void> {
  const now = new Date();
  const error = result.error ? redactOperationalText(result.error) : null;
  const terminal = result.outcome === 'completed' || result.outcome === 'ignored' || result.outcome === 'permanent_failure';
  const status = result.outcome === 'permanent_failure' ? 'dead' : terminal ? 'completed' : 'retry';
  const next = new Date(now.getTime() + retryDelaySeconds(job.attempts) * 1000).toISOString();
  const { data, error: writeError } = await admin.from('payment_webhook_jobs' as never)
    .update({
      status,
      last_error: error,
      next_attempt_at: terminal ? now.toISOString() : next,
      completed_at: terminal ? now.toISOString() : null,
      locked_at: null,
      lock_token: null,
      updated_at: now.toISOString(),
    } as never)
    .eq('body_hash', job.body_hash)
    .eq('status', 'processing')
    .eq('lock_token', job.lock_token)
    .select('body_hash');
  if (writeError || !data || data.length === 0) {
    throw new Error(`could not persist Paystack recovery result: ${redactOperationalText(writeError?.message ?? 'claim was lost')}`);
  }
}

export async function processClaimedPaystackEvent(admin: Admin, job: WebhookJob): Promise<WebhookDispatchResult> {
  let result: WebhookDispatchResult;
  try {
    const event = decryptWebhookPayload(job.payload_ciphertext);
    // Any charge repair is rebuilt from Paystack's current transaction record.
    // HMAC verification proves the original webhook's origin; this second
    // check prevents a stale/tampered queued money payload from granting access.
    if (event.event === 'charge.success') {
      const reference = job.reference ?? eventReference(event);
      if (!reference) result = { outcome: 'permanent_failure', status: 422, error: 'charge job has no reference' };
      else {
        const verified = await verifyTransaction(reference);
        if (!verified.ok) result = { outcome: 'retry', status: 500, error: `provider re-verification failed: ${verified.error}` };
        else if (verified.status !== 'success') result = { outcome: 'permanent_failure', status: 422, error: `provider status is ${verified.status}` };
        else result = await processPaystackEvent({
          event: 'charge.success',
          data: { ...verified.memberEventData, channel: verified.channel },
        });
      }
    } else {
      result = await processPaystackEvent(event);
    }
  } catch (e) {
    const error = redactOperationalText((e as Error).message);
    result = error.includes('cannot be decrypted')
      ? { outcome: 'permanent_failure', status: 422, error }
      : { outcome: 'retry', status: 500, error };
  }
  await finishPaystackEvent(admin, job, result);
  if (result.outcome === 'permanent_failure') {
    await captureServerEvent('paystack recovery requires operator repair', {
      event: job.event_name, reference: job.reference, attempts: job.attempts,
      error: result.error,
    });
  }
  return result;
}

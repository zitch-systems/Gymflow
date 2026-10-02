import 'server-only';
import { fulfillCharge } from '@/lib/paystack-fulfill';
import { isPlatformEvent, handlePlatformEvent } from '@/lib/platform-fulfill';
import { handleRefundEvent, isRefundEvent } from '@/lib/paystack-refund';
import { isMemberSubEvent, handleMemberSubEvent } from '@/lib/member-sub-fulfill';
import { isTransferEvent, handleTransferEvent } from '@/lib/transfer-fulfill';
import { createAdminClient } from '@/lib/supabase/admin';
import { confirmWhatsAppPayment } from '@/lib/whatsapp/notify';
import { readSplit } from '@/lib/paystack-split';
import { captureServerEvent } from '@/lib/server-error';

type Json = Record<string, unknown>;

export type WebhookDispatchResult = {
  outcome: 'completed' | 'ignored' | 'permanent_failure' | 'retry';
  status: 200 | 422 | 500;
  error?: string;
};

async function failure(flow: string, event: Json, error: string, permanent: boolean): Promise<WebhookDispatchResult> {
  const name = typeof event.event === 'string' ? event.event : 'unknown';
  await captureServerEvent(`paystack webhook ${flow} failed`, {
    event: name,
    error,
    reference: eventReference(event),
  });
  return { outcome: permanent ? 'permanent_failure' : 'retry', status: permanent ? 422 : 500, error };
}

export function eventReference(event: Json): string | null {
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Json;
  for (const key of ['reference', 'transfer_code', 'subscription_code']) {
    if (typeof d[key] === 'string' && d[key]) return d[key] as string;
  }
  if (typeof d.transaction_reference === 'string' && d.transaction_reference) {
    return d.transaction_reference;
  }
  const transaction = d.transaction;
  if (transaction && typeof transaction === 'object') {
    const nested = (transaction as Json).reference;
    if (typeof nested === 'string' && nested) return nested;
  }
  return null;
}

/** Route one already-authenticated provider event.  The durable queue owns
 * retries; this function returns a typed outcome instead of hiding permanent
 * handled failures behind a 200 response. */
export async function processPaystackEvent(event: Json): Promise<WebhookDispatchResult> {
  if (isRefundEvent(event)) {
    const result = await handleRefundEvent(event);
    if (!result.ok) return failure('refund', event, result.error ?? 'refund handler failed', Boolean(result.permanent));
    return { outcome: 'completed', status: 200 };
  }

  if (isTransferEvent(event)) {
    const result = await handleTransferEvent(event);
    if (!result.ok) return failure('transfer', event, result.error ?? 'transfer handler failed', Boolean(result.permanent));
    return { outcome: 'completed', status: 200 };
  }

  if (await isMemberSubEvent(event)) {
    const result = await handleMemberSubEvent(event);
    if (!result.ok) return failure('member sub', event, result.error ?? 'member subscription handler failed', Boolean(result.permanent));
    return { outcome: 'completed', status: 200 };
  }

  if (isPlatformEvent(event)) {
    const result = await handlePlatformEvent(event);
    if (!result.ok) return failure('platform', event, result.error ?? 'platform handler failed', Boolean(result.permanent));
    return { outcome: 'completed', status: 200 };
  }

  if (event.event !== 'charge.success') return { outcome: 'ignored', status: 200 };

  const d = (event.data as Json) ?? {};
  const result = await fulfillCharge({
    reference: d.reference as string,
    amountKobo: Number(d.amount ?? 0),
    currency: typeof d.currency === 'string' ? d.currency : '',
    channel: (d.channel as string) ?? null,
    metadata: (d.metadata as Json) ?? {},
    split: readSplit(d),
  });
  if (!result.ok) return failure('fulfill', event, result.error ?? 'charge fulfillment failed', Boolean(result.permanent));

  if (result.created) {
    try {
      const admin = createAdminClient();
      const meta = ((d.metadata as Json) ?? {}) as Record<string, unknown>;
      await confirmWhatsAppPayment(admin, {
        reference: d.reference as string,
        amountKobo: Number(d.amount ?? 0),
        memberId: typeof meta.member_id === 'string' ? meta.member_id : null,
        gymId: typeof meta.gym_id === 'string' ? meta.gym_id : null,
      });
    } catch {
      // Courtesy delivery is outside the payment transaction.
    }
  }

  return { outcome: 'completed', status: 200 };
}

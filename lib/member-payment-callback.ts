import 'server-only';
import type { VerifyResult } from '@/lib/paystack';
import { fulfillCharge } from '@/lib/paystack-fulfill';
import { handleMemberSubEvent } from '@/lib/member-sub-fulfill';

// Auto-renew and one-off payments share the redirect URL, but require their
// own fulfillment handlers. Provider verification supplies every input.
export async function fulfillVerifiedMemberCharge(v: Extract<VerifyResult, { ok: true }>): Promise<{ ok: boolean; error?: string }> {
  if (v.status !== 'success') return { ok: false, error: 'Payment has not succeeded.' };
  if (v.metadata.kind === 'member_subscription') {
    return handleMemberSubEvent({ event: 'charge.success', data: v.memberEventData });
  }
  return fulfillCharge({ reference: v.reference, amountKobo: v.amountKobo, currency: v.currency,
    channel: v.channel, metadata: v.metadata, split: v.split });
}

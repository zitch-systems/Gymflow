import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureServerEvent } from '@/lib/server-error';

// A verified refund records its exact amount and event identity atomically.
// Partial refunds retain access; full reversals revoke only that purchase's
// unused coverage. Legacy rows without an allocation go to operator review.
type Json = Record<string, unknown>;
export type RefundResult = { ok: boolean; error?: string; permanent?: boolean };

const REFUND_EVENTS = new Set([
  'charge.refund',       // merchant-initiated or Paystack-processed refund succeeded
  'refund.processed',    // async refund finished
  'refund.pending',      // async refund accepted (info-only; ack)
  'refund.failed',       // async refund failed (info-only; ack — original charge remains)
  'charge.dispute.resolve',
]);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

export function isRefundEvent(event: Json): boolean {
  const name = str(event.event) ?? '';
  return REFUND_EVENTS.has(name);
}

// Extract the paystack_reference of the ORIGINAL charge from a refund/dispute
// event. The shape varies by event type; try the common paths in order.
function refundReference(event: Json): string | null {
  const data = (event.data as Json) ?? {};
  return (
    str(data.reference) ??
    str((data.transaction as Json)?.reference) ??
    str(data.transaction_reference) ??
    null
  );
}

// A dispute is only a refund if the merchant lost (buyer got their money back).
// close-won / pending states don't refund the payment.
//
// Paystack's own vocabulary is the trap here: its resolve-dispute API takes
// exactly two resolutions, 'merchant-accepted' (the merchant conceded — the
// buyer's money goes back, i.e. the merchant LOST) and 'declined' (the merchant
// contested and kept the money). "Accepted" is the refund, "declined" is not —
// the opposite of how both words read. So 'declined' is rejected first, before
// any of the tolerant substring matches below, and no spelling containing it
// (e.g. 'merchant-declined') can be read as a loss. The 'lost'/'reversed'
// substrings stay as a catch-all for the other wordings Paystack has used on
// this event.
function isLostDispute(event: Json): boolean {
  if (str(event.event) !== 'charge.dispute.resolve') return false;
  const data = (event.data as Json) ?? {};
  const resolution = (str(data.resolution) ?? '').toLowerCase();
  if (!resolution || resolution.includes('declined')) return false;
  return resolution.includes('accepted') || resolution.includes('lost') || resolution.includes('reversed');
}

// A refund event that isn't a definitive "money went back" outcome (e.g.
// refund.pending, refund.failed, or a dispute that wasn't lost). Ack with no
// state change so Paystack stops resending.
function isInformationalOnly(event: Json): boolean {
  const name = str(event.event) ?? '';
  if (name === 'refund.pending' || name === 'refund.failed') return true;
  if (name === 'charge.dispute.resolve' && !isLostDispute(event)) return true;
  return false;
}

export async function handleRefundEvent(event: Json): Promise<RefundResult> {
  if (isInformationalOnly(event)) return { ok: true };

  const reference = refundReference(event);
  if (!reference) return { ok: false, error: 'missing reference in refund event', permanent: true };

  const data = (event.data as Json) ?? {};
  const name = str(event.event) ?? 'refund';
  const lostDispute = isLostDispute(event);
  const suppliedAmount = data.amount == null ? null : Number(data.amount);
  if (suppliedAmount !== null && (!Number.isSafeInteger(suppliedAmount) || suppliedAmount <= 0))
    return { ok: false, error: 'invalid refund amount', permanent: true };
  if (suppliedAmount === null && !lostDispute)
    return { ok: false, error: 'refund amount requires provider verification', permanent: true };
  const providerId = str(data.refund_reference) ??
    (typeof data.id === 'string' || typeof data.id === 'number' ? String(data.id) : null);
  if (!providerId && !lostDispute)
    return { ok: false, error: 'refund identity requires provider verification', permanent: true };
  const eventKey = `${lostDispute ? 'dispute' : 'refund'}:${providerId ?? reference}`;
  const transaction = (data.transaction as Json) ?? {};
  const currency = str(data.currency) ?? str(transaction.currency) ?? 'NGN';
  if (currency !== 'NGN') return { ok: false, error: 'unexpected refund currency', permanent: true };
  try {
    const admin = createAdminClient();
    const { data: result, error } = await admin.rpc('apply_payment_refund' as never, {
      p_event_key: eventKey, p_reference: reference, p_event_name: name,
      p_amount_kobo: suppliedAmount, p_currency: currency,
      p_full_dispute: lostDispute && suppliedAmount === null,
    } as never);
    if (error) return { ok: false, error: error.message, permanent: error.code === '22023' };
    const decision = result as unknown as { pending?: boolean; requires_review?: boolean } | null;
    if (!decision || typeof decision.pending !== 'boolean') return { ok: false, error: 'refund save not confirmed' };
    if (decision.requires_review) {
      await captureServerEvent('refund entitlement allocation requires review', { reference, event: name });
      return { ok: false, error: 'Refund recorded; legacy entitlement requires allocation review', permanent: true };
    }
    // Pending evidence remains in the database and is applied in the same
    // transaction when the original charge is eventually settled.
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

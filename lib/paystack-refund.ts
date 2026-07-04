import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

// Paystack refund + dispute handling. The payment_status enum has always had a
// 'refunded' state and the UI badges render it, but nothing in the code ever set
// it — refunds were invisible in the app. This handler flips the corresponding
// payment row (member or platform, matched by paystack_reference) and audit-logs.
//
// Deliberately does NOT reverse the membership extension or downgrade the gym's
// subscription state: refund policy is a business decision (partial refunds,
// goodwill credits, chargebacks vs merchant-initiated refunds) that shouldn't
// happen implicitly from a webhook. Making the refund visible is the primary
// goal; deciding what to do about it lives with the operator, in /superadmin.

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
function isLostDispute(event: Json): boolean {
  if (str(event.event) !== 'charge.dispute.resolve') return false;
  const data = (event.data as Json) ?? {};
  const resolution = (str(data.resolution) ?? '').toLowerCase();
  return resolution === 'merchant-declined' || resolution.includes('lost') || resolution.includes('reversed');
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

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const nowIso = new Date().toISOString();
  const name = str(event.event) ?? 'refund';

  // Try member payments first (the common case). Match by unique
  // paystack_reference. `.update(...).eq(...).select()` returns the touched rows
  // so we can tell which table (if any) actually had the record.
  const { data: memberHit, error: memberErr } = await admin
    .from('payments')
    .update({ payment_status: 'refunded', status: 'refunded' })
    .eq('paystack_reference', reference)
    .select('id, gym_id, member_id');
  if (memberErr) return { ok: false, error: memberErr.message };
  if (memberHit && memberHit.length) {
    const row = memberHit[0];
    void logAudit({
      action: name,
      table: 'payments',
      gymId: row.gym_id, recordId: row.id,
      values: { paystack_reference: reference, member_id: row.member_id, event: name, occurred_at: nowIso },
    });
    return { ok: true };
  }

  // Fall through to platform payments (gym → GymFlow SaaS billing).
  const { data: platHit, error: platErr } = await admin
    .from('platform_payments')
    .update({ payment_status: 'refunded' })
    .eq('paystack_reference', reference)
    .select('id, gym_id');
  if (platErr) return { ok: false, error: platErr.message };
  if (platHit && platHit.length) {
    const row = platHit[0];
    void logAudit({
      action: name,
      table: 'platform_payments',
      gymId: row.gym_id, recordId: row.id,
      values: { paystack_reference: reference, event: name, occurred_at: nowIso },
    });
    return { ok: true };
  }

  // No matching payment row found. Two legitimate causes: (a) the original
  // charge.success never fulfilled here (foreign transaction), or (b) the refund
  // arrived before the charge was recorded. Neither will improve on retry, so
  // ack with a warning rather than 500'ing forever.
  console.warn(`[paystack/refund] no matching payment for reference ${reference} (event ${name})`);
  return { ok: true };
}

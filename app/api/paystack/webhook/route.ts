import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { paystackSecretKey } from '@/lib/paystack';
import { fulfilMembershipPurchase, type FulfilAuthorization } from '@/lib/paystack-fulfill';

type WebhookData = {
  reference?: string;
  amount?: number;
  currency?: string;
  customer?: { email?: string };
  authorization?: FulfilAuthorization;
  metadata?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const raw = await request.text();
  const sig = request.headers.get('x-paystack-signature');
  if (!sig) return new NextResponse('Missing signature', { status: 400 });

  const expected = crypto
    .createHmac('sha512', paystackSecretKey())
    .update(raw)
    .digest('hex');

  // Constant-time comparison to avoid leaking the signature via timing.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return new NextResponse('Bad signature', { status: 401 });
  }

  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return new NextResponse('Bad JSON', { status: 400 });
  }

  // Mirror refunds back into our payments table so the dashboards/analytics
  // reflect reality. Paystack sends `refund.processed` with a nested
  // `transaction.reference` field.
  if (event.event === 'refund.processed' || event.event === 'refund.pending') {
    const supabase = createAdminClient();
    const data = (event.data ?? {}) as { transaction?: { reference?: string }; reference?: string };
    const ref = String(data.transaction?.reference ?? data.reference ?? '');
    if (ref) {
      await supabase
        .from('payments')
        .update({ payment_status: 'refunded' })
        .eq('paystack_reference', ref);
    }
    return NextResponse.json({ received: true });
  }

  // Mirror failed charge_authorization attempts (e.g. auto-debit declines)
  // so the wallet history matches Paystack.
  if (event.event === 'charge.failed') {
    const supabase = createAdminClient();
    const data = (event.data ?? {}) as { reference?: string };
    const ref = String(data.reference ?? '');
    if (ref) {
      await supabase
        .from('payments')
        .update({ payment_status: 'failed' })
        .eq('paystack_reference', ref);
    }
    return NextResponse.json({ received: true });
  }

  if (event.event === 'charge.success') {
    // Service-role: server-to-server call with no user session, so an
    // anon-scoped client would be blocked by RLS.
    const supabase = createAdminClient();
    const data = (event.data ?? {}) as WebhookData;
    const reference = String(data.reference ?? '');
    if (!reference) return NextResponse.json({ received: true });

    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const planId = typeof metadata.plan_id === 'string' ? metadata.plan_id : null;
    const customerEmail = data.customer?.email ?? null;

    // Membership payment: the webhook is the reliable backstop for the
    // browser /verify call. If the member paid but their tab closed before
    // /verify ran, fulfilment happens here instead. Idempotent on reference,
    // so it no-ops when /verify already created the membership.
    if (planId && customerEmail) {
      let memberId = typeof metadata.member_id === 'string' ? metadata.member_id : null;
      if (!memberId) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', customerEmail)
          .maybeSingle();
        memberId = prof?.id ?? null;
      }
      if (memberId) {
        const result = await fulfilMembershipPurchase(
          supabase,
          memberId,
          planId,
          {
            reference,
            amountKobo: Number(data.amount ?? 0),
            currency: data.currency,
            customerEmail,
            authorization: data.authorization,
          },
          { paymentMethod: 'card', notify: true },
        );
        if (!result.ok) {
          console.error('[GF webhook] membership fulfilment failed for', reference, '-', result.error);
        }
      } else {
        console.error('[GF webhook] could not resolve member for charge', reference, customerEmail);
      }
    } else {
      // Non-membership charge (e.g. instructor subscription handled by its own
      // verify route): just mark any existing payment row as settled.
      await supabase
        .from('payments')
        .update({ payment_status: 'successful' })
        .eq('paystack_reference', reference);
    }
  }

  return NextResponse.json({ received: true });
}

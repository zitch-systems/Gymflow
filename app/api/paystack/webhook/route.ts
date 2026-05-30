import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { paystackSecretKey } from '@/lib/paystack';
import { fulfilMembershipPurchase, type FulfilAuthorization } from '@/lib/paystack-fulfill';
import { fulfilPtPackPurchase } from '@/lib/pt-pack-fulfill';
import { fulfilInstructorSubscription } from '@/lib/instructor-sub-fulfill';
import { sendPayoutPaid, sendPayoutFailed } from '@/lib/email';
import { waPayoutPaid, waPayoutFailed } from '@/lib/whatsapp';
import { escapeIlikeEmail } from '@/lib/email-lookup';

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

  // Paystack Transfer events — used to settle instructor payouts. We match
  // on the `transfer_code` field stored on instructor_payouts. Three states
  // mirrored: success (→ status='paid'), failed (→ 'rejected'), reversed
  // (→ 'rejected'). Admin-initiated transfers via the Paystack dashboard hit
  // this path the same way our own initiated transfers will.
  if (
    event.event === 'transfer.success' ||
    event.event === 'transfer.failed' ||
    event.event === 'transfer.reversed'
  ) {
    const supabase = createAdminClient();
    const data = (event.data ?? {}) as { transfer_code?: string };
    const code = String(data.transfer_code ?? '');
    if (code) {
      const newStatus = event.event === 'transfer.success' ? 'paid' : 'rejected';

      // Look up the payout BEFORE updating so we know (a) whether this is a
      // genuine state transition or a Paystack webhook retry (in which case
      // status is already final and we must NOT re-notify), and (b) which
      // coach to notify + which bank/amount to put in the message.
      // paystack_transfer_code / bank_* / account_* are in the 20260529_*
      // migrations but not in the generated types yet — cast through never.
      const { data: priorRow } = await supabase
        .from('instructor_payouts')
        .select(
          'id, instructor_id, amount, status, bank_name, account_number, profiles:instructor_id(email, phone, full_name, first_name, notification_email, notification_whatsapp)' as never,
        )
        .eq('paystack_transfer_code' as never, code)
        .maybeSingle();

      await supabase
        .from('instructor_payouts')
        .update({
          status: newStatus,
          processed_at: new Date().toISOString(),
        })
        .eq('paystack_transfer_code' as never, code);

      // Notify only on a real transition. If priorRow.status === newStatus
      // this is a Paystack retry — webhooks promise at-least-once delivery,
      // not exactly-once, so the dedupe has to live on our side.
      type PayoutProfile = {
        email: string | null;
        phone: string | null;
        full_name: string | null;
        first_name: string | null;
        notification_email: boolean | null;
        notification_whatsapp: boolean | null;
      };
      type PayoutRowWithProfile = {
        id: string;
        instructor_id: string;
        amount: number;
        status: string;
        bank_name: string | null;
        account_number: string | null;
        profiles: PayoutProfile | PayoutProfile[] | null;
      };
      const row = priorRow as unknown as PayoutRowWithProfile | null;
      if (row && row.status !== newStatus) {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (profile) {
          const name = profile.first_name ?? profile.full_name ?? 'there';
          const amount = Number(row.amount);
          const earningsUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/coach/earnings`;
          // Honour notification opt-outs (NDPR). Payout notifications are
          // operational rather than promotional, but we still respect the
          // same flags for consistency with the rest of the app.
          const okEmail = profile.notification_email !== false && !!profile.email;
          const okWa = profile.notification_whatsapp !== false && !!profile.phone;
          if (event.event === 'transfer.success') {
            const bankName = row.bank_name ?? 'your bank';
            const last4 = row.account_number?.slice(-4) ?? '----';
            if (okEmail) await sendPayoutPaid(profile.email!, { name, amount, bankName, accountLast4: last4, earningsUrl });
            if (okWa) await waPayoutPaid(profile.phone!, { name, amount, bankName, accountLast4: last4 });
          } else {
            const reason = event.event === 'transfer.reversed' ? 'reversed' : 'failed';
            if (okEmail) await sendPayoutFailed(profile.email!, { name, amount, reason, earningsUrl });
            if (okWa) await waPayoutFailed(profile.phone!, { name, amount, reason, earningsUrl });
          }
        }
      }
    }
    return NextResponse.json({ received: true });
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
    // Lowercase the customer email so it can hit idx_profiles_email_lower
    // (migration 20260529_hot_path_indexes.sql) and so the email comparison
    // is case-insensitive in a deterministic way.
    const customerEmail = (data.customer?.email ?? '').toLowerCase() || null;
    const customerEmailPattern = customerEmail ? escapeIlikeEmail(customerEmail) : null;

    // PT-pack purchase backstop: if the member paid but their tab closed
    // before /api/paystack/verify-pt-pack ran, the credit would otherwise be
    // lost (money taken, nothing delivered). The buy button tags the charge
    // with metadata.purpose='pt_pack' + pack_id, so we can fulfil here.
    // Idempotent on reference — no-ops if /verify-pt-pack already ran.
    const purpose = typeof metadata.purpose === 'string' ? metadata.purpose : null;
    const packId = typeof metadata.pack_id === 'string' ? metadata.pack_id : null;
    if (purpose === 'pt_pack' && packId && customerEmail && customerEmailPattern) {
      // Resolve the member by the Paystack customer email (the buy flow runs
      // under the member's own session, so the email is theirs).
      const { data: prof } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', customerEmailPattern)
        .maybeSingle();
      const memberId = prof?.id ?? null;
      if (memberId) {
        const result = await fulfilPtPackPurchase(supabase, {
          packId,
          memberId,
          reference,
          authorizationCode: data.authorization?.authorization_code ?? null,
        });
        if (!result.ok) {
          console.error('[GF webhook] pt-pack fulfilment failed for', reference, '-', result.error);
        }
      } else {
        console.error('[GF webhook] could not resolve member for pt-pack charge', reference, customerEmail);
      }
      return NextResponse.json({ received: true });
    }

    // Instructor-subscription backstop: the subscribe button tags the charge
    // with metadata.gym_id + instructor_id + months (but no plan_id). If the
    // member's tab closed before /verify-instructor ran, fulfil here.
    // Idempotent on payment_reference — no-ops if /verify-instructor already ran.
    const instructorId = typeof metadata.instructor_id === 'string' ? metadata.instructor_id : null;
    const subGymId = typeof metadata.gym_id === 'string' ? metadata.gym_id : null;
    const monthsRaw = Number(metadata.months);
    if (!planId && instructorId && subGymId && Number.isFinite(monthsRaw) && monthsRaw >= 1 && monthsRaw <= 24 && customerEmail && customerEmailPattern) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', customerEmailPattern)
        .maybeSingle();
      const memberId = prof?.id ?? null;
      if (memberId) {
        const result = await fulfilInstructorSubscription(supabase, {
          gymId: subGymId,
          instructorId,
          memberId,
          months: Math.floor(monthsRaw),
          reference,
          authorization: data.authorization,
          memberEmail: customerEmail,
        });
        if (!result.ok) {
          console.error('[GF webhook] instructor-sub fulfilment failed for', reference, '-', result.error);
        }
      } else {
        console.error('[GF webhook] could not resolve member for instructor-sub charge', reference, customerEmail);
      }
      return NextResponse.json({ received: true });
    }

    // Membership payment: the webhook is the reliable backstop for the
    // browser /verify call. If the member paid but their tab closed before
    // /verify ran, fulfilment happens here instead. Idempotent on reference,
    // so it no-ops when /verify already created the membership.
    if (planId && customerEmail && customerEmailPattern) {
      let memberId = typeof metadata.member_id === 'string' ? metadata.member_id : null;
      if (!memberId) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', customerEmailPattern)
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

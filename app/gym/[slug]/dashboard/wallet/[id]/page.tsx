import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDateTime } from '@/lib/format';
import { ReceiptActions } from './receipt-actions';
import { ArrowLeft, Check, X, Clock } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string; id: string }> };

const STATUS_LABEL: Record<string, string> = {
  successful: 'Successful',
  failed: 'Failed',
  pending: 'Pending',
  refunded: 'Refunded',
};

export default async function ReceiptPage({ params }: PageProps) {
  const { slug, id } = await params;
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();

  // Scoped to the caller's own row (member_id + gym_id); RLS backs this up.
  const { data: payment } = await supabase
    .from('payments')
    .select('id, amount, payment_date, created_at, payment_status, payment_method, plan_id, paystack_reference')
    .eq('id', id)
    .eq('member_id', user.id)
    .eq('gym_id', gym.id)
    .maybeSingle();

  if (!payment) notFound();

  let planLabel = 'Membership payment';
  if (payment.plan_id) {
    const { data: plan } = await supabase.from('membership_plans').select('name').eq('id', payment.plan_id).maybeSingle();
    if (plan?.name) planLabel = plan.name;
  }

  const success = payment.payment_status === 'successful';
  const pending = payment.payment_status === 'pending';
  const failed = !success && !pending;
  const when = payment.payment_date ?? payment.created_at;

  const rows: { label: string; value: string }[] = [
    { label: 'Status', value: STATUS_LABEL[payment.payment_status ?? ''] ?? (payment.payment_status || '—') },
    { label: 'Date', value: fmtDateTime(when) },
    { label: 'Method', value: payment.payment_method || 'Paystack' },
    { label: 'Reference', value: payment.paystack_reference || payment.id },
    { label: 'Plan', value: planLabel },
    { label: 'Gym', value: gym.name },
  ];

  return (
    <div className="op-mobile member-portal member-app">
      <header className="op-header is-sub">
        <Link href="/dashboard/wallet" className="op-icon-btn" aria-label="Back to wallet">
          <ArrowLeft strokeWidth={1.8} />
        </Link>
        <strong className="op-header-title">Receipt</strong>
      </header>

      <div className="m-receipt">
        <div className="m-receipt-top">
          <div className={`m-receipt-ring${failed ? ' failed' : ''}`}>
            {failed ? <X strokeWidth={2.4} /> : pending ? <Clock strokeWidth={2.2} /> : <Check strokeWidth={2.4} />}
          </div>
          <div className="m-receipt-amt">{fmtNaira(Number(payment.amount ?? 0))}</div>
          <div className="m-receipt-label">{planLabel}</div>
        </div>

        <div className="m-wallet-group">
          <div className="m-receipt-list">
            {rows.map((r) => (
              <div key={r.label} className="m-receipt-row">
                <span>{r.label}</span>
                <b>{r.value}</b>
              </div>
            ))}
          </div>
        </div>

        <ReceiptActions />
      </div>
    </div>
  );
}

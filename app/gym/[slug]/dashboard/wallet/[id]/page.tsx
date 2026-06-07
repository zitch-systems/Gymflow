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
    <div className="ds-member">
      <div className="view on" data-v="receipt">
        <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
          <Link href="/dashboard/wallet" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to wallet">
            <ArrowLeft strokeWidth={1.9} />
          </Link>
          <strong className="htitle">Receipt</strong>
          <span style={{ width: 34, height: 34 }} aria-hidden />
        </div>

        <div className="receipt">
          <div className="rtop">
            <div
              className="ring"
              style={failed ? { background: 'var(--gf-danger-soft)', borderColor: 'rgba(255,69,96,0.25)', color: 'var(--gf-danger)' } : undefined}
            >
              {failed ? <X strokeWidth={2.4} /> : pending ? <Clock strokeWidth={2.2} /> : <Check strokeWidth={2.4} />}
            </div>
            <div className="ra">{fmtNaira(Number(payment.amount ?? 0))}</div>
            <div className="rl">{planLabel}</div>
          </div>

          <div className="group">
            <div className="rlist">
              {rows.map((r) => (
                <div key={r.label} className="rrow">
                  <span>{r.label}</span>
                  <b>{r.value}</b>
                </div>
              ))}
            </div>
          </div>

          <ReceiptActions />
        </div>
      </div>
    </div>
  );
}

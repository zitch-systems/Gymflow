import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Share2, Check, X, Clock, ArrowDownLeft } from 'lucide-react';
import { PrintReceiptButton } from './print-button';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDateTime } from '@/lib/format';
import { paymentAmounts, paymentStatusLabel } from '@/lib/payment-display';

export const metadata = { title: 'Receipt' };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const { data: p } = await supabase
    .from('payments')
    .select('id, amount, refunded_amount, payment_status, payment_date, created_at, payment_method, plan_id, paystack_reference')
    .eq('id', id).eq('member_id', user.id).eq('gym_id', gym.id)
    .maybeSingle();
  if (!p) notFound();

  let planLabel = 'Membership payment';
  if (p.plan_id) {
    const { data: plan } = await supabase.from('membership_plans').select('name').eq('id', p.plan_id).maybeSingle();
    if (plan?.name) planLabel = plan.name;
  }

  const pending = p.payment_status === 'pending';
  const failed = p.payment_status === 'failed';
  const amounts = paymentAmounts(p);
  const refund = amounts.refundState !== 'none';
  const rows: [string, string][] = [
    ['Status', paymentStatusLabel(p)],
    ['Date', fmtDateTime(p.payment_date ?? p.created_at)],
    ['Method', p.payment_method || 'Paystack'],
    ['Reference', p.paystack_reference || p.id],
    ['Plan', planLabel],
    ['Gym', gym.name],
  ];
  if (refund) rows.splice(1, 0,
    ['Original charge', fmtNaira(amounts.gross)],
    ['Refunded', fmtNaira(amounts.refunded)],
    ['Net paid', fmtNaira(amounts.net)],
  );

  return (
    <section className="view on" data-v="receipt">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/dashboard/wallet" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to wallet"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Receipt</strong>
        <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Share receipt"><Share2 strokeWidth={1.9} /></button>
      </div>

      <div className="receipt">
        <div className="rtop">
          <div className="ring" style={failed ? { background: 'var(--gf-danger-soft)', borderColor: 'rgba(255,69,96,0.25)', color: 'var(--gf-danger)' } : refund ? { background: 'var(--gf-warning-soft)', borderColor: 'rgba(255,176,32,0.25)', color: 'var(--gf-warning)' } : undefined}>
            {failed ? <X strokeWidth={2.4} /> : pending ? <Clock strokeWidth={2.2} /> : refund ? <ArrowDownLeft strokeWidth={2.2} /> : <Check strokeWidth={2.4} />}
          </div>
          <div className="ra">{fmtNaira(refund ? amounts.net : amounts.gross)}</div>
          <div className="rl">{planLabel}</div>
        </div>
        <div className="group">
          <div className="rlist">
            {rows.map(([k, v]) => (<div className="rrow" key={k}><span>{k}</span><b>{v}</b></div>))}
          </div>
        </div>
        <PrintReceiptButton />
      </div>
    </section>
  );
}

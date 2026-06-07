import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Share2, Check, X, Clock, Download } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Receipt' };

const STATUS_LABEL: Record<string, string> = { successful: 'Successful', pending: 'Pending', failed: 'Failed', refunded: 'Refunded' };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const { data: p } = await supabase
    .from('payments')
    .select('id, amount, payment_status, payment_date, created_at, payment_method, plan_id, paystack_reference')
    .eq('id', id).eq('member_id', user.id).eq('gym_id', gym.id)
    .maybeSingle();
  if (!p) notFound();

  let planLabel = 'Membership payment';
  if (p.plan_id) {
    const { data: plan } = await supabase.from('membership_plans').select('name').eq('id', p.plan_id).maybeSingle();
    if (plan?.name) planLabel = plan.name;
  }

  const ok = p.payment_status === 'successful';
  const pending = p.payment_status === 'pending';
  const failed = !ok && !pending;
  const rows: [string, string][] = [
    ['Status', STATUS_LABEL[p.payment_status ?? ''] ?? (p.payment_status || '—')],
    ['Date', fmtDateTime(p.payment_date ?? p.created_at)],
    ['Method', p.payment_method || 'Paystack'],
    ['Reference', p.paystack_reference || p.id],
    ['Plan', planLabel],
    ['Gym', gym.name],
  ];

  return (
    <section className="view on" data-v="receipt">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/dashboard/wallet" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to wallet"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Receipt</strong>
        <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Share receipt"><Share2 strokeWidth={1.9} /></button>
      </div>

      <div className="receipt">
        <div className="rtop">
          <div className="ring" style={failed ? { background: 'var(--gf-danger-soft)', borderColor: 'rgba(255,69,96,0.25)', color: 'var(--gf-danger)' } : undefined}>
            {failed ? <X strokeWidth={2.4} /> : pending ? <Clock strokeWidth={2.2} /> : <Check strokeWidth={2.4} />}
          </div>
          <div className="ra">{fmtNaira(Number(p.amount ?? 0))}</div>
          <div className="rl">{planLabel}</div>
        </div>
        <div className="group">
          <div className="rlist">
            {rows.map(([k, v]) => (<div className="rrow" key={k}><span>{k}</span><b>{v}</b></div>))}
          </div>
        </div>
        <button className="gf-btn gf-btn-secondary gf-btn-full"><Download strokeWidth={1.9} style={{ width: 16, height: 16 }} /> Download PDF</button>
      </div>
    </section>
  );
}

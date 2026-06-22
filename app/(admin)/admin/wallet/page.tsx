import { Banknote, ArrowDownLeft, ArrowUpRight, CreditCard } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';

export const metadata = { title: 'Wallet' };

const STATUS: Record<string, [string, string]> = {
  successful: ['gf-badge-success', 'Settled'],
  pending: ['gf-badge-info', 'Processing'],
  failed: ['gf-badge-danger', 'Failed'],
  refunded: ['gf-badge-warning', 'Refunded'],
};

export default async function AdminWallet() {
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [{ data: rows }, { data: monthRows }] = await Promise.all([
    supabase.from('payments')
      .select('id, amount, payment_status, payment_date, created_at, payment_method, plan_id, member_id')
      .eq('gym_id', gym.id).order('payment_date', { ascending: false }).limit(60),
    supabase.from('payments')
      .select('amount, payment_status, payment_date')
      .eq('gym_id', gym.id).gte('payment_date', monthStart.toISOString()),
  ]);

  const collected = (monthRows ?? []).filter((p) => p.payment_status === 'successful').reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const pending = (monthRows ?? []).filter((p) => p.payment_status === 'pending').reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const failed = (monthRows ?? []).filter((p) => p.payment_status !== 'successful' && p.payment_status !== 'pending').reduce((s, p) => s + Number(p.amount ?? 0), 0);

  // Member names + plan names for the table.
  const memberIds = [...new Set((rows ?? []).map((r) => r.member_id).filter(Boolean) as string[])];
  const planIds = [...new Set((rows ?? []).map((r) => r.plan_id).filter(Boolean) as string[])];
  const [{ data: profiles }, { data: plans }] = await Promise.all([
    memberIds.length ? supabase.from('profiles').select('id, full_name, email').in('id', memberIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    planIds.length ? supabase.from('membership_plans').select('id, name').in('id', planIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));
  const planById = new Map((plans ?? []).map((p) => [p.id, p.name]));

  return (
    <>
      <div className="page-h"><div><h1>Wallet</h1><p>{gym.name} · settlements via Paystack</p></div></div>

      <div className="wtop">
        <div className="balance">
          <small>Collected this month</small>
          <div className="amt">{fmtNaira(collected)}</div>
          <div className="sub">{fmtNaira(pending)} pending · {(rows ?? []).length} recent transactions</div>
          <div className="acts" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Banknote strokeWidth={1.9} size={16} />
            <span style={{ fontSize: '0.84rem', opacity: 0.92 }}>Paystack settles collections to your bank account automatically (T+1).</span>
          </div>
        </div>
        <div className="wstats">
          <div className="ws"><div className="ic" style={{ background: 'var(--gf-warning-soft)', color: 'var(--gf-warning)' }}><ArrowUpRight strokeWidth={1.9} /></div><div><div className="v">{fmtNaira(pending)}</div><div className="l">Pending settlement</div></div></div>
          <div className="ws"><div className="ic" style={{ background: 'var(--gf-danger-soft)', color: 'var(--gf-danger)' }}><ArrowDownLeft strokeWidth={1.9} /></div><div><div className="v">{fmtNaira(failed)}</div><div className="l">Failed this month</div></div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h"><div><h3>Transactions</h3><div className="sub">All settlements &amp; payments</div></div></div>
        {(rows ?? []).length === 0 ? (
          <div className="empty"><div className="eic"><CreditCard strokeWidth={1.6} /></div><h3>No payments yet</h3><p>Member renewals and purchases will show here.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Description</th><th>Method</th><th>Date</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {(rows ?? []).map((p) => {
                const st = STATUS[p.payment_status ?? ''] ?? ['gf-badge-neutral', p.payment_status ?? '—'];
                const ok = p.payment_status === 'successful';
                return (
                  <tr key={p.id}>
                    <td><div className="who"><span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)', border: 'none' }}><CreditCard strokeWidth={1.9} size={15} /></span><div><strong>{(p.plan_id && planById.get(p.plan_id)) || 'Payment'} · {p.member_id ? nameById.get(p.member_id) : '—'}</strong><small>{p.payment_method ?? 'Paystack'}</small></div></div></td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{p.payment_method ?? 'Paystack'}</td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{fmtDate(p.payment_date ?? p.created_at)}</td>
                    <td><span className={`gf-badge ${st[0]}`}><span className="gf-dot" />{st[1]}</span></td>
                    <td className={`naira tx-amt ${ok ? 'in' : 'out'}`} style={{ textAlign: 'right' }}>{ok ? '+' : ''}{fmtNaira(Number(p.amount ?? 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

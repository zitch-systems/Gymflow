import { Banknote, ArrowRight } from 'lucide-react';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';

export const metadata = { title: 'Payouts · Instructor' };

const STATUS: Record<string, [string, string]> = {
  paid: ['gf-badge-success', 'Paid'], processing: ['gf-badge-info', 'Processing'],
  pending: ['gf-badge-warning', 'Pending'], requested: ['gf-badge-warning', 'Requested'], failed: ['gf-badge-danger', 'Failed'],
};

export default async function CoachPayouts() {
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();

  const [{ data: payouts }, { data: bank }] = await Promise.all([
    supabase.from('instructor_payouts')
      .select('id, amount, status, requested_at, processed_at, notes')
      .eq('instructor_id', user.id).eq('gym_id', gym.id)
      .order('requested_at', { ascending: false }).limit(12),
    supabase.from('instructor_bank_details').select('bank_name, account_number, account_name').eq('instructor_id', user.id).maybeSingle(),
  ]);

  const pending = (payouts ?? []).filter((p) => p.status !== 'paid').reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const acctMasked = bank?.account_number ? `•••• ${bank.account_number.slice(-4)}` : null;

  return (
    <>
      <div className="hdr"><h1>Payouts</h1><p>Payouts via Paystack{bank?.bank_name ? ` · ${bank.bank_name}` : ''}</p></div>

      <div className="wtop">
        <div className="balance">
          <small>Pending payout</small>
          <div className="amt">{fmtNaira(pending)}</div>
          <div style={{ fontSize: '0.84rem', opacity: 0.92 }}>{(payouts ?? []).filter((p) => p.status !== 'paid').length} payout{(payouts ?? []).filter((p) => p.status !== 'paid').length === 1 ? '' : 's'} awaiting</div>
          <div className="acts"><button className="gf-btn"><Banknote strokeWidth={1.9} size={16} /> Request early</button></div>
        </div>
        <div className="bankcard">
          <span className="lbl">Payout account</span>
          <span className="num">{bank ? `${bank.bank_name} ${acctMasked}` : 'No bank account on file'}</span>
          <span style={{ color: 'var(--gf-text-muted)', fontSize: '0.82rem' }}>{bank?.account_name ?? 'Add a payout account to get paid'}</span>
          <span className="link" style={{ marginTop: 6 }}>{bank ? 'Change account' : 'Add account'} <ArrowRight strokeWidth={2} size={14} /></span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h"><div><h3>Payout history</h3><div className="sub">Recent payouts</div></div></div>
        {(payouts ?? []).length === 0 ? (
          <div className="empty"><div className="eic"><Banknote strokeWidth={1.6} /></div><h3>No payouts yet</h3><p>Your weekly payouts will show here.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Requested</th><th>Notes</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {(payouts ?? []).map((p) => {
                const st = STATUS[p.status] ?? ['gf-badge-neutral', p.status];
                return (
                  <tr key={p.id}>
                    <td>{fmtDate(p.requested_at)}</td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{p.notes ?? '—'}</td>
                    <td><span className={`gf-badge ${st[0]}`}>{st[1]}</span></td>
                    <td className="naira" style={{ textAlign: 'right' }}>{fmtNaira(Number(p.amount ?? 0))}</td>
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

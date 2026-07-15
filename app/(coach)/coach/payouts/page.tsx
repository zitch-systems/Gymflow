import { Banknote } from 'lucide-react';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { availableBalance } from '@/lib/payout-balance';
import { BankCard } from '@/components/coach/bank-card';
import { RequestPayout } from '@/components/coach/request-payout';

export const metadata = { title: 'Payouts · Instructor' };

// Aligned with the DB check constraint: requested / approved / paid / rejected.
const STATUS: Record<string, [string, string]> = {
  requested: ['gf-badge-warning', 'Requested'],
  approved: ['gf-badge-info', 'In transit'],
  paid: ['gf-badge-success', 'Paid'],
  rejected: ['gf-badge-danger', 'Rejected'],
};

export default async function CoachPayouts() {
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();
  const payoutsAvailable = Boolean(process.env.PAYSTACK_SECRET_KEY);

  const sharePct = Number((gym as { instructor_revenue_share_pct?: number }).instructor_revenue_share_pct ?? 70);
  const [{ data: payouts }, { data: bank }, available] = await Promise.all([
    supabase.from('instructor_payouts')
      .select('id, amount, status, requested_at, processed_at, notes')
      .eq('instructor_id', user.id).eq('gym_id', gym.id)
      .order('requested_at', { ascending: false }).limit(12),
    supabase.from('instructor_bank_details').select('bank_name, bank_code, account_number, account_name').eq('instructor_id', user.id).maybeSingle(),
    availableBalance(supabase, gym.id, user.id, Number.isFinite(sharePct) ? sharePct : 70),
  ]);

  const inFlight = (payouts ?? []).filter((p) => p.status === 'requested' || p.status === 'approved');
  const pending = inFlight.reduce((s, p) => s + Number(p.amount ?? 0), 0);

  return (
    <>
      <div className="hdr"><h1>Payouts</h1><p>Payouts via Paystack{bank?.bank_name ? ` · ${bank.bank_name}` : ''}</p></div>

      <div className="wtop">
        <div className="balance">
          <small>Available to withdraw</small>
          <div className="amt">{fmtNaira(available)}</div>
          <div style={{ fontSize: '0.84rem', opacity: 0.92 }}>
            {pending > 0 ? `${fmtNaira(pending)} in ${inFlight.length} payout${inFlight.length === 1 ? '' : 's'} in progress` : 'Earnings ready for payout'}
          </div>
          <RequestPayout available={available} hasBank={Boolean(bank)} hasOpen={inFlight.length > 0} />
          <div className="acts" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Banknote strokeWidth={1.9} size={16} />
            <span style={{ fontSize: '0.84rem', opacity: 0.92 }}>Your gym reviews requests and pays to the account below.</span>
          </div>
        </div>
        <BankCard bank={bank ?? null} payoutsAvailable={payoutsAvailable} />
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

'use client';

import { useActionState } from 'react';
import { AlertCircle, Check, Send, X } from 'lucide-react';
import { payPayout, rejectPayout, type ActionState } from '@/lib/actions/payouts';

const INIT: ActionState = { ok: false, error: null };

export type QueuedPayout = {
  id: string;
  instructorName: string;
  amount: number;
  status: string; // 'requested' | 'approved'
  requestedAt: string | null;
  bank: string;   // "Bank · account_name · ****1234"
  notes: string | null;
};

function Row({ p }: { p: QueuedPayout }) {
  const [pay, payAction, payPending] = useActionState(payPayout, INIT);
  const [rej, rejAction, rejPending] = useActionState(rejectPayout, INIT);
  const fb = [pay, rej].find((s) => s.error) ?? [pay, rej].find((s) => s.message);
  const inTransit = p.status === 'approved';

  return (
    <>
      <tr>
        <td>
          <strong>{p.instructorName}</strong>
          <div style={{ fontSize: '0.78rem', color: 'var(--gf-text-secondary)' }}>{p.bank}</div>
          {p.notes && <div style={{ fontSize: '0.78rem', color: 'var(--gf-warning)' }}>{p.notes}</div>}
        </td>
        <td className="naira">₦{p.amount.toLocaleString('en-NG')}</td>
        <td>
          {inTransit ? (
            <span className="gf-badge gf-badge-info">In transit</span>
          ) : (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <form action={payAction}>
                <input type="hidden" name="payoutId" value={p.id} />
                <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={payPending || rejPending}>
                  <Send strokeWidth={1.9} size={14} /> {payPending ? 'Paying…' : 'Pay'}
                </button>
              </form>
              <form action={rejAction}>
                <input type="hidden" name="payoutId" value={p.id} />
                <button className="gf-btn gf-btn-secondary gf-btn-sm" disabled={payPending || rejPending} aria-label={`Reject ${p.instructorName}'s payout`}>
                  <X strokeWidth={1.9} size={14} /> {rejPending ? '…' : 'Reject'}
                </button>
              </form>
            </div>
          )}
        </td>
      </tr>
      {fb && (fb.error || fb.message) && (
        <tr><td colSpan={3}>
          <p className={`act-fb ${fb.error ? 'err' : 'ok'}`} style={{ margin: '4px 0' }} aria-live="polite">
            {fb.error ? <AlertCircle size={14} strokeWidth={2} /> : <Check size={14} strokeWidth={2.5} />} {fb.error ?? fb.message}
          </p>
        </td></tr>
      )}
    </>
  );
}

// Payout queue on /admin/instructors — open requests + transfers in flight.
// Server page passes the fully-resolved rows; this component just renders and
// fires the pay/reject actions (which re-validate everything server-side).
export function PayoutQueue({ payouts }: { payouts: QueuedPayout[] }) {
  if (!payouts.length) return null;
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="panel-h"><div><h3>Payout requests</h3><div className="sub">Instructor earnings awaiting transfer</div></div></div>
      <table className="tbl">
        <thead><tr><th>Instructor</th><th>Amount</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
        <tbody>{payouts.map((p) => <Row key={p.id} p={p} />)}</tbody>
      </table>
    </div>
  );
}

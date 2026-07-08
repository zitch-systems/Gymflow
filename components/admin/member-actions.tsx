'use client';

import { useState, useActionState } from 'react';
import { ScanLine, LogOut, CreditCard, RefreshCw, UserX, UserCheck, Check, AlertCircle } from 'lucide-react';
import { manualCheckIn, manualCheckOut, recordPayment, renewMembership, setMemberActive, type ActionState } from '@/lib/actions/admin-member';

const INIT: ActionState = { ok: false, error: null };
type Plan = { id: string; name: string; price: number };

export function MemberActions({ memberId, plans, isActive, checkedIn = false }: { memberId: string; plans: Plan[]; isActive: boolean; checkedIn?: boolean }) {
  const [panel, setPanel] = useState<null | 'pay' | 'renew'>(null);
  // Check-in / check-out toggles with the member's live state (open visit today).
  const [ci, ciAction, ciPending] = useActionState(checkedIn ? manualCheckOut : manualCheckIn, INIT);
  const [pay, payAction, payPending] = useActionState(recordPayment, INIT);
  const [ren, renAction, renPending] = useActionState(renewMembership, INIT);
  const [st, stAction, stPending] = useActionState(setMemberActive, INIT);

  const states = [ci, pay, ren, st];
  const fb = states.find((s) => s.error) ?? states.find((s) => s.message);

  return (
    <div className="panel actions-panel">
      <div className="panel-h"><h3>Quick actions</h3></div>
      <div className="act-bar">
        <form action={ciAction}>
          <input type="hidden" name="memberId" value={memberId} />
          <button className="gf-btn gf-btn-secondary gf-btn-sm" disabled={ciPending}>
            {checkedIn ? <LogOut strokeWidth={1.9} size={15} /> : <ScanLine strokeWidth={1.9} size={15} />}
            {ciPending ? (checkedIn ? ' Checking out…' : ' Checking in…') : (checkedIn ? ' Check out' : ' Check in')}
          </button>
        </form>
        <button type="button" className={`gf-btn gf-btn-secondary gf-btn-sm${panel === 'pay' ? ' on' : ''}`} onClick={() => setPanel(panel === 'pay' ? null : 'pay')}><CreditCard strokeWidth={1.9} size={15} /> Record payment</button>
        {plans.length > 0 && <button type="button" className={`gf-btn gf-btn-secondary gf-btn-sm${panel === 'renew' ? ' on' : ''}`} onClick={() => setPanel(panel === 'renew' ? null : 'renew')}><RefreshCw strokeWidth={1.9} size={15} /> Renew</button>}
        <form action={stAction}>
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="active" value={isActive ? 'false' : 'true'} />
          <button className={`gf-btn gf-btn-sm ${isActive ? 'gf-btn-secondary' : 'gf-btn-primary'}`} disabled={stPending}>
            {isActive ? <><UserX strokeWidth={1.9} size={15} /> Suspend</> : <><UserCheck strokeWidth={1.9} size={15} /> Reactivate</>}
          </button>
        </form>
      </div>

      {panel === 'pay' && (
        <form action={payAction} className="act-form" key="pay">
          <input type="hidden" name="memberId" value={memberId} />
          <div className="af-grid">
            <label>Amount (₦)<input name="amount" type="number" min="1" step="1" className="gf-input" placeholder="15000" required /></label>
            <label>Method
              <select name="method" className="gf-input" defaultValue="cash">
                <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="crypto">Crypto</option>
              </select>
            </label>
            <label>Plan (optional)
              <select name="planId" className="gf-input" defaultValue="">
                <option value="">— none —</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <label className="af-check"><input type="checkbox" name="extend" /> Also extend membership by the plan duration</label>
          <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={payPending}>{payPending ? 'Saving…' : 'Save payment'}</button>
        </form>
      )}

      {panel === 'renew' && (
        <form action={renAction} className="act-form" key="renew">
          <input type="hidden" name="memberId" value={memberId} />
          <div className="af-grid">
            <label>Plan
              <select name="planId" className="gf-input" required defaultValue={plans[0]?.id ?? ''}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — ₦{Number(p.price).toLocaleString('en-NG')}</option>)}
              </select>
            </label>
          </div>
          <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={renPending}>{renPending ? 'Renewing…' : 'Confirm renewal'}</button>
        </form>
      )}

      {fb && (fb.error || fb.message) && (
        <p className={`act-fb ${fb.error ? 'err' : 'ok'}`}>
          {fb.error ? <AlertCircle size={15} strokeWidth={2} /> : <Check size={15} strokeWidth={2.5} />} {fb.error ?? fb.message}
        </p>
      )}
    </div>
  );
}

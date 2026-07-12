'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { reviewPayoutRequest, type ReviewPayoutState } from '@/lib/actions/gym';
import { fmtDateTime } from '@/lib/format';

const INIT: ReviewPayoutState = { ok: false, error: null };

export type Row = {
  id: string; gym_id: string; bank_name: string; bank_code: string;
  account_number: string; account_name: string; name_matches: boolean; status: string;
  created_at: string;
  gyms: { name: string; slug: string; bank_name: string | null; account_number: string | null; account_name: string | null } | null;
};

// One review card in the pending queue. A form-level decision picker so the
// server action gets `decision=approve|reject` alongside the other fields;
// approve-with-name-mismatch is a separate checkbox that the action requires
// when name_matches is false.
export function PayoutApprovalRow({ r }: { r: Row }) {
  const [state, action, pending] = useActionState(reviewPayoutRequest, INIT);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');

  return (
    <form className="pa-row" action={action} style={{ borderTop: '1px solid var(--gf-border)', padding: '14px 0', display: 'grid', gap: 10 }}>
      <input type="hidden" name="request_id" value={r.id} />
      <input type="hidden" name="decision" value={decision} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <strong style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1rem' }}>{r.gyms?.name ?? r.gym_id.slice(0, 8)}</strong>
          <span style={{ color: 'var(--gf-text-muted)', marginLeft: 10, fontSize: '0.8rem' }}>Submitted {fmtDateTime(r.created_at)}</span>
        </div>
        {!r.name_matches && (
          <span className="gf-badge gf-badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <AlertTriangle size={13} strokeWidth={2} /> Name mismatch
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.86rem' }}>
        <div>
          <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Currently on file</div>
          {r.gyms?.bank_name
            ? <div>{r.gyms.bank_name}<br />{r.gyms.account_name}<br />••••{(r.gyms.account_number ?? '').slice(-4)}</div>
            : <div style={{ color: 'var(--gf-text-muted)' }}>None</div>}
        </div>
        <div>
          <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Requested</div>
          <div>{r.bank_name}<br /><strong>{r.account_name}</strong><br />••••{r.account_number.slice(-4)}</div>
        </div>
      </div>

      {!r.name_matches && decision === 'approve' && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.84rem' }}>
          <input type="checkbox" name="allow_name_mismatch" style={{ accentColor: 'var(--gf-brand)' }} />
          Allow name mismatch — the account holder&rsquo;s name doesn&rsquo;t match the gym&rsquo;s business name. Approving anyway also disables the check for future submissions from this gym.
        </label>
      )}

      {decision === 'reject' && (
        <input className="gf-input" name="reject_reason" placeholder="Reason (shown to gym owner)" style={{ maxWidth: 480 }} />
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="gf-btn gf-btn-primary gf-btn-sm" onClick={() => setDecision('approve')} disabled={pending}>
          <Check size={14} strokeWidth={2.4} /> {pending && decision === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button type="submit" className="gf-btn gf-btn-secondary gf-btn-sm" onClick={() => setDecision('reject')} disabled={pending}>
          <X size={14} strokeWidth={2.4} /> {pending && decision === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        {state.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem' }}>{state.error}</span>}
        {state.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem' }}>Done ✓</span>}
      </div>
    </form>
  );
}

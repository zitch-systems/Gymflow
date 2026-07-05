'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, Check, HandCoins } from 'lucide-react';
import { requestPayout, type ActionState } from '@/lib/actions/payouts';

const INIT: ActionState = { ok: false, error: null };

// Coach-side "Request payout" — collapsed to a button until opened. The
// server re-validates everything (available balance, bank details, one open
// request at a time); `available`/`hasBank`/`hasOpen` here only shape the UI.
export function RequestPayout({ available, hasBank, hasOpen }: { available: number; hasBank: boolean; hasOpen: boolean }) {
  const [state, action, pending] = useActionState(requestPayout, INIT);
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <p className="act-fb ok" style={{ marginTop: 10 }} aria-live="polite">
        <Check size={15} strokeWidth={2.5} /> {state.message}
      </p>
    );
  }
  if (hasOpen) {
    return <p style={{ fontSize: '0.84rem', opacity: 0.92, marginTop: 10 }}>A payout is already in progress — you can request another once it completes.</p>;
  }
  if (!hasBank) {
    return <p style={{ fontSize: '0.84rem', opacity: 0.92, marginTop: 10 }}>Add your bank account below to request payouts.</p>;
  }
  if (available <= 0) {
    return <p style={{ fontSize: '0.84rem', opacity: 0.92, marginTop: 10 }}>Nothing to withdraw yet — earnings appear here as your clients&rsquo; payments come in.</p>;
  }

  return (
    <div style={{ marginTop: 10 }}>
      {!open ? (
        <button type="button" className="gf-btn gf-btn-primary gf-btn-sm" onClick={() => setOpen(true)}>
          <HandCoins strokeWidth={1.9} size={15} /> Request payout
        </button>
      ) : (
        <form action={action} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            name="amount" type="number" min="1" max={available} step="1" required
            defaultValue={available} className="gf-input" style={{ width: 140 }}
            aria-label="Payout amount (naira)"
          />
          <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={pending}>
            {pending ? 'Requesting…' : 'Request'}
          </button>
          <button type="button" className="gf-btn gf-btn-secondary gf-btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        </form>
      )}
      {state.error && (
        <p className="act-fb err" style={{ marginTop: 8 }} aria-live="polite">
          <AlertCircle size={15} strokeWidth={2} /> {state.error}
        </p>
      )}
    </div>
  );
}

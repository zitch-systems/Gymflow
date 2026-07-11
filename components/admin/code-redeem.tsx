'use client';

import { useActionState } from 'react';
import { KeyRound } from 'lucide-react';
import { redeemCheckinCode, type ActionState } from '@/lib/actions/admin-member';

const INIT: ActionState = { ok: false, error: null };

// Front-desk code entry — redeems the 6-digit code a member generated on their
// check-in page, checking them in (or out if they're already inside).
export function CodeRedeem() {
  const [state, action, pending] = useActionState(redeemCheckinCode, INIT);
  return (
    <form action={action} className="code-redeem">
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="Member’s 6-digit code"
        aria-label="Member check-in code"
        required
      />
      <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={pending} type="submit">
        <KeyRound size={14} strokeWidth={2} /> {pending ? '…' : 'Check in/out with code'}
      </button>
      {state.error && <p className="code-redeem-msg err" role="alert">{state.error}</p>}
      {state.ok && state.message && <p className="code-redeem-msg ok" role="status">{state.message}</p>}
    </form>
  );
}

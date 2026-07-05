'use client';

import { useActionState } from 'react';
import { Repeat, Check, AlertCircle } from 'lucide-react';
import { cancelAutoRenewSelf } from '@/lib/actions/member-billing';
import type { ActionState } from '@/lib/actions/member-billing';

const INIT: ActionState = { ok: false, error: null };

// Self-serve cancel row for the member profile page. Renders only when the
// member has an active Paystack Subscription (auto_debit_enabled + a
// subscription code). Nothing shown for one-off members.
export function AutoRenewRow({ subId }: { subId: string | null }) {
  const [state, action, pending] = useActionState(cancelAutoRenewSelf, INIT);

  if (!subId) return null;
  if (state.ok) {
    return (
      <div className="row" aria-live="polite">
        <span className="ic" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)' }}><Check strokeWidth={1.9} /></span>
        <div className="m"><strong>Auto-renew off</strong><small>Access continues until the current period ends.</small></div>
      </div>
    );
  }

  return (
    <>
      <div className="row">
        <span className="ic" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}><Repeat strokeWidth={1.9} /></span>
        <div className="m"><strong>Auto-renew is on</strong><small>Charged automatically each period</small></div>
        <form action={action}>
          <input type="hidden" name="subId" value={subId} />
          <button className="gf-btn gf-btn-secondary gf-btn-sm" disabled={pending}>
            {pending ? 'Turning off…' : 'Turn off'}
          </button>
        </form>
      </div>
      {state.error && (
        <p className="act-fb err" style={{ padding: '0 16px 8px' }}>
          <AlertCircle size={15} strokeWidth={2} /> {state.error}
        </p>
      )}
    </>
  );
}

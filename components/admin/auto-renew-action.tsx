'use client';

import { useActionState } from 'react';
import { Repeat, Check, AlertCircle } from 'lucide-react';
import { cancelAutoRenewByStaff } from '@/lib/actions/member-billing';
import type { ActionState } from '@/lib/actions/member-billing';

const INIT: ActionState = { ok: false, error: null };

// Staff-only override to cancel a member's auto-renew from the admin member
// detail page. Rendered inside the same panel as the other member actions
// when the sub actually has auto-renew on.
export function AutoRenewAction({ subId, on }: { subId: string | null; on: boolean }) {
  const [state, action, pending] = useActionState(cancelAutoRenewByStaff, INIT);

  if (!subId || !on) return null;

  return (
    <div className="panel actions-panel">
      <div className="panel-h"><h3>Auto-renew</h3></div>
      <p style={{ margin: '0 0 12px', color: 'var(--gf-muted)' }}>
        This member is on Paystack auto-renew. Turning it off stops future charges; access continues until the current period ends.
      </p>
      <form action={action} style={{ display: 'flex', gap: 8 }}>
        <input type="hidden" name="subId" value={subId} />
        <button className="gf-btn gf-btn-secondary gf-btn-sm" disabled={pending}>
          <Repeat strokeWidth={1.9} size={15} /> {pending ? 'Cancelling…' : 'Turn off auto-renew'}
        </button>
      </form>
      {(state.error || state.message) && (
        <p className={`act-fb ${state.error ? 'err' : 'ok'}`} style={{ marginTop: 10 }}>
          {state.error ? <AlertCircle size={15} strokeWidth={2} /> : <Check size={15} strokeWidth={2.5} />} {state.error ?? state.message}
        </p>
      )}
    </div>
  );
}

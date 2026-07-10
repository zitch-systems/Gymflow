'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, Check, Pause, Clock, PauseCircle } from 'lucide-react';
import { requestFreeze, type ActionState } from '@/lib/actions/freeze';

const INIT: ActionState = { ok: false, error: null };

// Member-side freeze row for /dashboard/profile. Renders one of several states:
//   • active + enabled   — "Freeze membership" trigger + inline reason form
//   • active + disabled  — nothing (gym doesn't offer self-service freezes)
//   • pause_requested    — "Freeze pending" info row (no action)
//   • paused             — "Frozen" info row (staff must resume)
//   • no sub             — nothing rendered
// `enabled` reflects the gym's member_freeze_enabled setting; a member who is
// already pending/frozen still sees their status even if it was since disabled.
export function FreezeRequest({ status, enabled = true }: { status: 'active' | 'pause_requested' | 'paused' | null; enabled?: boolean }) {
  const [state, action, pending] = useActionState(requestFreeze, INIT);
  const [open, setOpen] = useState(false);

  if (!status) return null;
  if (status === 'active' && !enabled) return null;

  if (status === 'pause_requested') {
    return (
      <div className="row" aria-live="polite">
        <span className="ic" style={{ background: 'var(--gf-warning-soft)', color: 'var(--gf-warning)' }}><Clock strokeWidth={1.9} /></span>
        <div className="m"><strong>Freeze pending</strong><small>Waiting for staff to approve</small></div>
      </div>
    );
  }
  if (status === 'paused') {
    return (
      <div className="row" aria-live="polite">
        <span className="ic" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}><PauseCircle strokeWidth={1.9} /></span>
        <div className="m"><strong>Membership frozen</strong><small>Contact the gym to resume</small></div>
      </div>
    );
  }

  // status === 'active'
  return (
    <>
      <button
        type="button"
        className="row"
        onClick={() => setOpen((o) => !o)}
        style={{ background: 'none', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left' }}
        aria-expanded={open}
      >
        <span className="ic"><Pause strokeWidth={1.9} /></span>
        <div className="m"><strong>Freeze membership</strong><small>Pause your plan while you&rsquo;re away</small></div>
      </button>
      {open && (
        <form action={action} style={{ padding: '0 16px 12px' }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--gf-muted)', margin: '4px 0' }}>
            Reason (optional)
            <input
              name="reason"
              type="text"
              maxLength={500}
              placeholder="Travel, injury, etc."
              className="gf-input"
              style={{ marginTop: 4 }}
            />
          </label>
          <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={pending}>
            {pending ? 'Requesting…' : 'Request freeze'}
          </button>
          {(state.error || state.message) && (
            <p className={`act-fb ${state.error ? 'err' : 'ok'}`} style={{ marginTop: 8 }}>
              {state.error ? <AlertCircle size={15} strokeWidth={2} /> : <Check size={15} strokeWidth={2.5} />} {state.error ?? state.message}
            </p>
          )}
        </form>
      )}
    </>
  );
}

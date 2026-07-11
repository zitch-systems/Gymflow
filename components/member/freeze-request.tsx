'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, Check, Pause, Clock, PauseCircle } from 'lucide-react';
import { requestFreeze, type ActionState } from '@/lib/actions/freeze';

const INIT: ActionState = { ok: false, error: null };

// Must match MIN_DAYS_TO_FREEZE in lib/actions/freeze.ts.
const MIN_DAYS_TO_FREEZE = 7;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

// Member-side freeze row for /dashboard/profile. Renders one of several states:
//   • active + enabled          — "Freeze membership" trigger + inline form (dates + reason)
//   • active + expiring/expired — a locked "Renew first" info row (server rejects the request too)
//   • active + disabled         — nothing (gym doesn't offer self-service freezes)
//   • pause_requested           — "Freeze pending" info row (no action)
//   • paused                    — "Frozen" info row (staff must resume)
//   • no sub                    — nothing rendered
// `enabled` reflects the gym's member_freeze_enabled setting; a member who is
// already pending/frozen still sees their status even if it was since disabled.
export function FreezeRequest({ status, enabled = true, subEndDate = null }: { status: 'active' | 'pause_requested' | 'paused' | null; enabled?: boolean; subEndDate?: string | null }) {
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
  const today = iso(new Date());
  const daysLeft = subEndDate ? daysBetween(today, subEndDate) : null;
  const tooClose = daysLeft !== null && daysLeft < MIN_DAYS_TO_FREEZE;

  if (tooClose) {
    return (
      <div className="row" aria-live="polite">
        <span className="ic" style={{ background: 'var(--gf-warning-soft)', color: 'var(--gf-warning)' }}><AlertCircle strokeWidth={1.9} /></span>
        <div className="m">
          <strong>Freeze unavailable</strong>
          <small>{daysLeft <= 0 ? 'Membership expired — renew to freeze.' : `Only ${daysLeft} day${daysLeft === 1 ? '' : 's'} left — renew to freeze.`}</small>
        </div>
      </div>
    );
  }

  const defaultStart = today;
  const defaultEnd = iso(new Date(Date.now() + 30 * 86_400_000));
  const maxStart = subEndDate ?? '';

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
        <form action={action} style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--gf-muted)' }}>
              Freeze from
              <input name="pauseStart" type="date" defaultValue={defaultStart} min={today} max={maxStart || undefined} required className="gf-input" style={{ marginTop: 4 }} />
            </label>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--gf-muted)' }}>
              Resume on
              <input name="pauseEnd" type="date" defaultValue={defaultEnd} min={iso(new Date(Date.now() + 86_400_000))} required className="gf-input" style={{ marginTop: 4 }} />
            </label>
          </div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--gf-muted)' }}>
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
          <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={pending} style={{ alignSelf: 'flex-start' }}>
            {pending ? 'Requesting…' : 'Request freeze'}
          </button>
          {(state.error || state.message) && (
            <p className={`act-fb ${state.error ? 'err' : 'ok'}`}>
              {state.error ? <AlertCircle size={15} strokeWidth={2} /> : <Check size={15} strokeWidth={2.5} />} {state.error ?? state.message}
            </p>
          )}
        </form>
      )}
    </>
  );
}

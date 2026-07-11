'use client';

import { useActionState } from 'react';
import { AlertCircle, Check, Pause, Play, ThumbsDown, Snowflake } from 'lucide-react';
import { approveFreeze, denyFreeze, resumeFreeze, freezeMembership, type ActionState } from '@/lib/actions/freeze';

const INIT: ActionState = { ok: false, error: null };

type FreezeState = {
  id: string;
  status: string;
  paused_at: string | null;
  pause_reason: string | null;
  pause_start: string | null;
  pause_end: string | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (s: string | null) =>
  s ? new Date(s + (s.length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

// From/to date pickers shared by the "freeze" and "approve" forms. `from`
// defaults to today, `to` to 30 days out. When approving a pending request the
// member's requested window is passed in and pre-fills the inputs so staff can
// confirm-or-tweak instead of re-entering.
function DateWindow({ start, end }: { start?: string | null; end?: string | null } = {}) {
  const today = new Date();
  const in30 = new Date(today.getTime() + 30 * 86_400_000);
  const startValue = start && start >= iso(today) ? start : iso(today);
  const endValue = end && end > startValue ? end : iso(in30);
  return (
    <div className="frow" style={{ marginBottom: 10 }}>
      <div className="gf-form-group">
        <label className="gf-form-label" style={{ fontSize: 12 }}>Freeze from</label>
        <input className="gf-input" type="date" name="pauseStart" defaultValue={startValue} min={iso(today)} required />
      </div>
      <div className="gf-form-group">
        <label className="gf-form-label" style={{ fontSize: 12 }}>Resume on</label>
        <input className="gf-input" type="date" name="pauseEnd" defaultValue={endValue} min={iso(new Date(today.getTime() + 86_400_000))} required />
      </div>
    </div>
  );
}

// Freeze management for the admin member detail page. Renders one of four
// distinct states so staff always know the next possible move:
//   • active           — freeze form (from/to window + optional reason)
//   • pause_requested  — approve (with window) / deny
//   • paused           — frozen window + resume
//   • other/none       — nothing
export function FreezeActions({ sub }: { sub: FreezeState | null }) {
  const [freeze, freezeAction, freezePending] = useActionState(freezeMembership, INIT);
  const [approve, approveAction, approvePending] = useActionState(approveFreeze, INIT);
  const [deny, denyAction, denyPending] = useActionState(denyFreeze, INIT);
  const [resume, resumeAction, resumePending] = useActionState(resumeFreeze, INIT);

  if (!sub || (sub.status !== 'active' && sub.status !== 'pause_requested' && sub.status !== 'paused')) return null;

  const states = [freeze, approve, deny, resume];
  const fb = states.find((s) => s.error) ?? states.find((s) => s.message);
  const pausedWindow = sub.pause_start && sub.pause_end ? `${fmtDate(sub.pause_start)} → ${fmtDate(sub.pause_end)}` : null;
  const pausedSince = fmtDate(sub.paused_at);

  return (
    <div className="panel actions-panel">
      <div className="panel-h"><h3>Membership freeze</h3></div>

      {sub.status === 'active' && (
        <form action={freezeAction}>
          <input type="hidden" name="subId" value={sub.id} />
          <p style={{ margin: '0 0 12px', color: 'var(--gf-muted)' }}>
            Pause this membership for a set period. The frozen days are credited back to the end date when you resume.
          </p>
          <DateWindow />
          <div className="gf-form-group" style={{ marginBottom: 12 }}>
            <label className="gf-form-label" style={{ fontSize: 12 }}>Reason (optional)</label>
            <input className="gf-input" name="reason" type="text" maxLength={500} placeholder="Travel, injury, etc." />
          </div>
          <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={freezePending}>
            <Snowflake strokeWidth={1.9} size={15} /> {freezePending ? 'Freezing…' : 'Freeze membership'}
          </button>
        </form>
      )}

      {sub.status === 'pause_requested' && (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--gf-muted)' }}>
            Member has requested a freeze{sub.pause_reason ? <>: <em>&ldquo;{sub.pause_reason}&rdquo;</em></> : '.'}
            {sub.pause_start && sub.pause_end ? <> They asked for <strong>{fmtDate(sub.pause_start)} → {fmtDate(sub.pause_end)}</strong>.</> : null}
            {' '}Confirm or adjust the window to approve.
          </p>
          <form action={approveAction} style={{ marginBottom: 10 }}>
            <input type="hidden" name="subId" value={sub.id} />
            <DateWindow start={sub.pause_start} end={sub.pause_end} />
            <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={approvePending}>
              <Pause strokeWidth={1.9} size={15} /> {approvePending ? 'Approving…' : 'Approve freeze'}
            </button>
          </form>
          <form action={denyAction}>
            <input type="hidden" name="subId" value={sub.id} />
            <button className="gf-btn gf-btn-secondary gf-btn-sm" disabled={denyPending}>
              <ThumbsDown strokeWidth={1.9} size={15} /> {denyPending ? 'Denying…' : 'Deny request'}
            </button>
          </form>
        </>
      )}

      {sub.status === 'paused' && (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--gf-muted)' }}>
            {pausedWindow
              ? <>Frozen <strong>{pausedWindow}</strong>. </>
              : <>Frozen since {pausedSince ?? 'recently'}. </>}
            Resuming credits the frozen days back to the membership end date.
          </p>
          <form action={resumeAction}>
            <input type="hidden" name="subId" value={sub.id} />
            <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={resumePending}>
              <Play strokeWidth={1.9} size={15} /> {resumePending ? 'Resuming…' : 'Resume membership'}
            </button>
          </form>
        </>
      )}

      {fb && (fb.error || fb.message) && (
        <p className={`act-fb ${fb.error ? 'err' : 'ok'}`} style={{ marginTop: 10 }}>
          {fb.error ? <AlertCircle size={15} strokeWidth={2} /> : <Check size={15} strokeWidth={2.5} />} {fb.error ?? fb.message}
        </p>
      )}
    </div>
  );
}

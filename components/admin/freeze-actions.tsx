'use client';

import { useActionState } from 'react';
import { AlertCircle, Check, Pause, Play, ThumbsDown } from 'lucide-react';
import { approveFreeze, denyFreeze, resumeFreeze, type ActionState } from '@/lib/actions/freeze';

const INIT: ActionState = { ok: false, error: null };

type FreezeState = {
  id: string;
  status: string;
  paused_at: string | null;
  pause_reason: string | null;
};

// Freeze management for the admin member detail page. Renders the three
// distinct control states — pending approval, currently paused, no action —
// so staff always know what the next possible move is.
export function FreezeActions({ sub }: { sub: FreezeState | null }) {
  const [approve, approveAction, approvePending] = useActionState(approveFreeze, INIT);
  const [deny, denyAction, denyPending] = useActionState(denyFreeze, INIT);
  const [resume, resumeAction, resumePending] = useActionState(resumeFreeze, INIT);

  if (!sub || (sub.status !== 'pause_requested' && sub.status !== 'paused')) return null;

  const fb = [approve, deny, resume].find((s) => s.error) ?? [approve, deny, resume].find((s) => s.message);
  const pausedSince = sub.paused_at ? new Date(sub.paused_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="panel actions-panel">
      <div className="panel-h"><h3>Membership freeze</h3></div>

      {sub.status === 'pause_requested' && (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--gf-muted)' }}>
            Member has requested a freeze{sub.pause_reason ? <>: <em>&ldquo;{sub.pause_reason}&rdquo;</em></> : '.'}
          </p>
          <div className="act-bar">
            <form action={approveAction}>
              <input type="hidden" name="subId" value={sub.id} />
              <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={approvePending}>
                <Pause strokeWidth={1.9} size={15} /> {approvePending ? 'Approving…' : 'Approve freeze'}
              </button>
            </form>
            <form action={denyAction}>
              <input type="hidden" name="subId" value={sub.id} />
              <button className="gf-btn gf-btn-secondary gf-btn-sm" disabled={denyPending}>
                <ThumbsDown strokeWidth={1.9} size={15} /> {denyPending ? 'Denying…' : 'Deny'}
              </button>
            </form>
          </div>
        </>
      )}

      {sub.status === 'paused' && (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--gf-muted)' }}>
            Frozen since {pausedSince ?? 'recently'}. Resuming will credit the frozen days back to the membership end date.
          </p>
          <div className="act-bar">
            <form action={resumeAction}>
              <input type="hidden" name="subId" value={sub.id} />
              <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={resumePending}>
                <Play strokeWidth={1.9} size={15} /> {resumePending ? 'Resuming…' : 'Resume membership'}
              </button>
            </form>
          </div>
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

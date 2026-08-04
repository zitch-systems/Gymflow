'use client';

import { useActionState } from 'react';
import { UserRoundCheck, Check, AlertCircle } from 'lucide-react';
import { assignTrainer, type ActionState } from '@/lib/actions/admin-member';

const INIT: ActionState = { ok: false, error: null };

export type TrainerOption = { id: string; name: string };

// Match a member who bought the private-trainer add-on with one of the gym's
// instructors. Rendered on the member detail page only when they actually paid
// for it — an assign control on a member with no add-on is an invitation to
// give away coaching nobody was charged for.
//
// The blank option un-assigns, which matters more than it looks: a coach
// leaving, or a wrong match, otherwise leaves the member paired to someone who
// isn't training them while the page insists they're handled.
export function TrainerAssign({
  memberId, instructors, currentId,
}: { memberId: string; instructors: TrainerOption[]; currentId: string | null }) {
  const [state, action, pending] = useActionState(assignTrainer, INIT);
  const current = instructors.find((i) => i.id === currentId) ?? null;

  return (
    <div className="panel actions-panel">
      <div className="panel-h"><h3>Private trainer</h3></div>
      <p style={{ margin: '0 0 12px', color: 'var(--gf-muted)' }}>
        {current
          ? <>This member paid for the private-trainer add-on and is training with <strong>{current.name}</strong>.</>
          : <>This member paid for the private-trainer add-on and hasn&rsquo;t been matched with a trainer yet.</>}
      </p>
      {instructors.length === 0 ? (
        <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> No active instructors on staff to assign yet.</p>
      ) : (
        <form action={action} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="memberId" value={memberId} />
          <label className="gf-form-label" htmlFor="assign-trainer-select" style={{ width: '100%' }}>Trainer</label>
          <select
            className="gf-select" id="assign-trainer-select" name="instructorId"
            defaultValue={currentId ?? ''} style={{ maxWidth: 240 }}
          >
            <option value="">— No trainer assigned —</option>
            {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <button className="gf-btn gf-btn-secondary gf-btn-sm" disabled={pending}>
            <UserRoundCheck strokeWidth={1.9} size={15} /> {pending ? 'Saving…' : 'Save trainer'}
          </button>
        </form>
      )}
      {(state.error || state.message) && (
        <p className={`act-fb ${state.error ? 'err' : 'ok'}`} style={{ marginTop: 10 }}>
          {state.error ? <AlertCircle size={15} strokeWidth={2} /> : <Check size={15} strokeWidth={2.5} />} {state.error ?? state.message}
        </p>
      )}
    </div>
  );
}

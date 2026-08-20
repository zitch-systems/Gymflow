'use client';

import { useActionState, useState } from 'react';
import { Check, AlertCircle, TriangleAlert } from 'lucide-react';
import { setGymCommission, type CommissionState } from '@/lib/actions/platform-gym';
import { editorMode, type CommissionMode } from '@/lib/commission-settings';

const INIT: CommissionState = { ok: false, error: null };

// Inline per-gym commission editor for the superadmin gym table. Platform
// operators only (the action is requirePlatformAdmin-gated).
//
// The result is shown, not hinted at. This used to signal outcome only through
// a `title` tooltip and a swapped icon, which made a save that failed look
// almost exactly like one that worked — an operator who set a gym to 10%, saw
// nothing change, and reloaded to find 5% had no way to tell whether the write
// had been rejected, whether they had forgotten to submit, or whether the page
// was stale. Three different problems wearing the same face.
//
// A gym is charged EITHER a percentage of each member payment or a flat naira
// amount per payment. The toggle picks which, and only the matching input is
// shown — two boxes side by side would leave the operator guessing which of
// the numbers on screen is the one being charged. The other value still exists
// on the row (the percentage is Paystack's fallback in fixed mode, see
// setGymCommission) and is submitted unchanged, so switching modes back and
// forth never quietly discards it.
export function CommissionEditor({ gymId, pct, mode = 'percentage', fixed = 0, splitting = true }: {
  gymId: string;
  pct: number;
  /** Which arrangement is live for this gym. */
  mode?: CommissionMode;
  /** Flat naira per payment, used in fixed mode. */
  fixed?: number;
  /** False when the gym has no Paystack subaccount, so the rate splits nothing. */
  splitting?: boolean;
}) {
  const [state, action, pending] = useActionState(setGymCommission, INIT);

  // What the last save STORED is adopted once, then the operator's own
  // selection wins again — see lib/commission-settings.ts editorMode. Preferring
  // state.mode outright reads like the same rule but is not: useActionState
  // state survives the revalidate, so after the first save the toggle would
  // never move again.
  const [draftMode, setDraftMode] = useState<CommissionMode>(mode);
  const [adopted, setAdopted] = useState<CommissionMode | null>(null);
  const next = editorMode({ draft: draftMode, adopted }, state.mode);
  if (next.adopted !== adopted) {
    // A render-phase update on this component only: React re-renders with the
    // adopted mode before committing anything, so no flash of the old one.
    setAdopted(next.adopted);
    setDraftMode(next.mode);
  }
  const activeMode = next.mode;

  // `notSplitting` from the action wins over the prop: it is the state as of
  // this save, while the prop is as of the last page render.
  const live = state.notSplitting === undefined ? splitting : !state.notSplitting;
  const settled = state.ok || Boolean(state.error);

  return (
    <div className="commission-cell">
      <form action={action} className="commission-edit">
        <input type="hidden" name="gymId" value={gymId} />
        <input type="hidden" name="mode" value={activeMode} />

        {/* A real <select> rather than a styled pair of buttons: it is
            keyboard- and screen-reader-native, and it fits the table cell at
            the size the number inputs already are. */}
        {/* Named by aria-label rather than a visible <label>: the table cell has
            no room for one, and this repo has no visually-hidden utility to
            borrow. A native select carries its own role and keyboard handling. */}
        <select
          className="mode" aria-label="Commission type" title="Commission type"
          value={activeMode} disabled={pending}
          onChange={(e) => setDraftMode(e.target.value as CommissionMode)}
        >
          <option value="percentage">%</option>
          <option value="fixed">₦</option>
        </select>

        {activeMode === 'fixed' ? (
          <>
            {/* The percentage rides along hidden so a save in fixed mode does
                not wipe the fallback rate off the row. */}
            <input type="hidden" name="pct" value={state.pct ?? pct} />
            <input
              type="number" name="fixed" min="0" step="50"
              defaultValue={state.fixed ?? fixed}
              aria-label="Fixed platform commission in naira per payment" disabled={pending}
            />
            <span className="pct">per payment</span>
          </>
        ) : (
          <>
            <input type="hidden" name="fixed" value={state.fixed ?? fixed} />
            <input
              type="number" name="pct" min="0" max="100" step="0.1"
              defaultValue={state.pct ?? pct}
              aria-label="Platform commission percent" disabled={pending}
            />
            <span className="pct">%</span>
          </>
        )}

        <button type="submit" className="save" disabled={pending} aria-label="Save commission">
          {state.error ? <AlertCircle size={13} strokeWidth={2.2} /> : <Check size={13} strokeWidth={2.4} />}
        </button>
      </form>

      {/* aria-live so the outcome reaches a screen reader too — this is the only
          confirmation that a money setting changed. */}
      <p className={`commission-note${state.error ? ' bad' : settled ? ' good' : ''}`} aria-live="polite">
        {pending ? 'Saving…'
          : state.error ? state.error
            : state.message ? state.message
              : !live ? <><TriangleAlert size={11} strokeWidth={2.2} /> No payout split — not charged</>
                : null}
      </p>
    </div>
  );
}

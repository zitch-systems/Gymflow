'use client';

import { useActionState } from 'react';
import { Check, AlertCircle, TriangleAlert } from 'lucide-react';
import { setGymCommission, type CommissionState } from '@/lib/actions/platform-gym';

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
export function CommissionEditor({ gymId, pct, splitting = true }: {
  gymId: string;
  pct: number;
  /** False when the gym has no Paystack subaccount, so the rate splits nothing. */
  splitting?: boolean;
}) {
  const [state, action, pending] = useActionState(setGymCommission, INIT);

  // `notSplitting` from the action wins over the prop: it is the state as of
  // this save, while the prop is as of the last page render.
  const live = state.notSplitting === undefined ? splitting : !state.notSplitting;
  const settled = state.ok || Boolean(state.error);

  return (
    <div className="commission-cell">
      <form action={action} className="commission-edit">
        <input type="hidden" name="gymId" value={gymId} />
        <input
          type="number" name="pct" min="0" max="100" step="0.1"
          defaultValue={state.pct ?? pct}
          aria-label="Platform commission percent" disabled={pending}
        />
        <span className="pct">%</span>
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

'use client';

import { useActionState } from 'react';
import { Check, AlertCircle, PauseCircle, PlayCircle, Hourglass, Repeat } from 'lucide-react';
import {
  setGymStatus, extendGymTrial, setGymSubscription, type CommissionState,
} from '@/lib/actions/platform-gym';
import { PLATFORM_PLANS, PLAN_TIERS } from '@/lib/platform-plans';

const INIT: CommissionState = { ok: false, error: null };

function Feedback({ state }: { state: CommissionState }) {
  if (state.error) return <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>;
  if (state.ok && state.message) return <p className="act-fb ok"><Check size={15} strokeWidth={2.2} /> {state.message}</p>;
  return null;
}

// Platform-operator controls on a single gym. Every action is
// requirePlatformAdmin-gated and audit-logged server-side; this component only
// collects the input. Split into three independent forms so one failing (a bad
// day count, say) doesn't discard what was typed into the others.
export function GymControls({
  gymId, suspended, plan, subscriptionStatus,
}: {
  gymId: string;
  suspended: boolean;
  plan: string | null;
  subscriptionStatus: string;
}) {
  const [statusState, statusAction, statusPending] = useActionState(setGymStatus, INIT);
  const [trialState, trialAction, trialPending] = useActionState(extendGymTrial, INIT);
  const [subState, subAction, subPending] = useActionState(setGymSubscription, INIT);

  return (
    <div className="panel actions-panel">
      <div className="panel-h">
        <div>
          <h3>Platform controls</h3>
          <div className="sub">Operator-only. Each change is written to this gym’s audit trail.</div>
        </div>
      </div>

      {/* Suspend / reactivate — the platform kill switch. Confirmed inline
          because suspending takes the gym's console AND public page offline. */}
      <form action={statusAction} className="act-bar">
        <input type="hidden" name="gymId" value={gymId} />
        <input type="hidden" name="status" value={suspended ? 'active' : 'suspended'} />
        <button
          type="submit"
          className={suspended ? 'gf-btn gf-btn-primary gf-btn-sm' : 'gf-btn gf-btn-danger gf-btn-sm'}
          disabled={statusPending}
        >
          {suspended
            ? <><PlayCircle size={15} strokeWidth={1.9} /> Reactivate gym</>
            : <><PauseCircle size={15} strokeWidth={1.9} /> Suspend gym</>}
        </button>
        <span style={{ color: 'var(--gf-text-muted)', fontSize: '0.82rem' }}>
          {suspended
            ? 'Suspended: staff see a notice instead of the console and the public page is hidden.'
            : 'Takes the admin console and public page offline until reactivated.'}
        </span>
      </form>
      <Feedback state={statusState} />

      {/* Extend trial */}
      <form action={trialAction} className="act-form">
        {/* maxWidth: .af-grid is auto-fit/1fr, so a lone field stretches the
            whole panel — a 1000px-wide box for a two-digit day count. */}
        <div className="af-grid" style={{ maxWidth: 220 }}>
          <label>
            Extend free trial by (days)
            <input type="number" name="days" min="1" max="90" step="1" defaultValue={14} className="gf-input" disabled={trialPending} />
          </label>
        </div>
        <input type="hidden" name="gymId" value={gymId} />
        <button type="submit" className="gf-btn gf-btn-secondary gf-btn-sm" disabled={trialPending}>
          <Hourglass size={15} strokeWidth={1.9} /> Extend trial
        </button>
        <Feedback state={trialState} />
      </form>

      {/* Subscription override */}
      <form action={subAction} className="act-form">
        <div className="af-grid">
          <label>
            Plan
            <select name="plan" defaultValue={plan ?? ''} className="gf-input" disabled={subPending}>
              <option value="">No plan</option>
              {PLAN_TIERS.map((t) => <option key={t} value={t}>{PLATFORM_PLANS[t].name}</option>)}
            </select>
          </label>
          <label>
            Subscription status
            <select name="status" defaultValue={subscriptionStatus} className="gf-input" disabled={subPending}>
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <input type="hidden" name="gymId" value={gymId} />
        <p className="addmember-note">
          Manual override for comping a gym or repairing a missed webhook. Paystack is not called — the gym’s
          subscription codes are left alone so a later webhook still reconciles.
        </p>
        <button type="submit" className="gf-btn gf-btn-secondary gf-btn-sm" disabled={subPending}>
          <Repeat size={15} strokeWidth={1.9} /> Save subscription
        </button>
        <Feedback state={subState} />
      </form>
    </div>
  );
}

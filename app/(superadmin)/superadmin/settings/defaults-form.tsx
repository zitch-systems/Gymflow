'use client';

import { useActionState } from 'react';
import { Percent, CalendarClock } from 'lucide-react';
import { setPlatformDefaults, type SettingsState } from '@/lib/actions/platform-settings';

const INIT: SettingsState = { ok: false, error: null };

/**
 * The commission and trial length new gyms start on.
 *
 * This panel used to be two disabled inputs reading "3%" and "14 days" — a mock
 * left from the design prototype, wired to nothing, and stating a rate GymFlow
 * does not charge. It now writes platform_settings, which both provisioning
 * paths read (lib/actions/onboard.ts and lib/provision.ts).
 */
export function PlatformDefaultsForm({ commissionPct, trialDays }: { commissionPct: number; trialDays: number }) {
  const [state, action, pending] = useActionState(setPlatformDefaults, INIT);

  return (
    <form className="panel" action={action}>
      <div className="panel-title">Platform defaults</div>
      <div className="panel-desc">
        What a newly provisioned gym starts on. Changing these never re-prices a live gym — each one carries its own
        rate, editable from its page under Gyms.
      </div>

      <div className="frow">
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="default_commission_pct">
            <Percent size={13} strokeWidth={2} style={{ verticalAlign: '-1px', marginRight: 5 }} />
            Platform commission
          </label>
          <input
            className="gf-input"
            id="default_commission_pct"
            name="default_commission_pct"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={commissionPct}
            required
          />
          <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
            GymFlow&apos;s share of member dues, taken as the Paystack split.
          </small>
        </div>
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="default_trial_days">
            <CalendarClock size={13} strokeWidth={2} style={{ verticalAlign: '-1px', marginRight: 5 }} />
            Trial length
          </label>
          <input
            className="gf-input"
            id="default_trial_days"
            name="default_trial_days"
            type="number"
            min={0}
            max={365}
            step={1}
            defaultValue={trialDays}
            required
          />
          <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
            Days before a new gym&apos;s trial_ends_at falls due. 0 = no trial.
          </small>
        </div>
      </div>

      <div className="gf-form-group">
        <label className="gf-form-label">Default currency</label>
        <input className="gf-input" value="₦ Naira (NGN)" readOnly disabled />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <button className="gf-btn gf-btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save defaults'}
        </button>
        {state.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>{state.message ?? 'Saved ✓'}</span>}
        {state.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{state.error}</span>}
      </div>
    </form>
  );
}

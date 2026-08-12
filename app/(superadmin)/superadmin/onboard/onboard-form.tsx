'use client';

import { useActionState } from 'react';
import { UserPlus, Check, AlertCircle } from 'lucide-react';
import { provisionGym, type OnboardState } from '@/lib/actions/onboard';
import { PLATFORM_PLANS, PLAN_TIERS, DEFAULT_CYCLE, CYCLE_SUFFIX, planPrice } from '@/lib/platform-plans';
import { fmtNaira } from '@/lib/format';

const initial: OnboardState = { ok: false, error: null };

// Built from the catalogue: a hardcoded tier that no longer exists would be
// rejected by the gyms_subscription_plan_valid check constraint at insert time.
const PLAN_OPTIONS = PLAN_TIERS.map((tier) => ({
  tier,
  label: `${PLATFORM_PLANS[tier].name} — ${fmtNaira(planPrice(tier, DEFAULT_CYCLE).amountKobo / 100)}${CYCLE_SUFFIX[DEFAULT_CYCLE]}`,
}));

export function OnboardForm() {
  const [state, action, pending] = useActionState(provisionGym, initial);

  return (
    <form className="panel" action={action}>
      <div className="panel-title">Gym details</div>
      <div className="panel-desc">The basics — we provision the subdomain instantly.</div>
      <div className="frow">
        <div className="gf-form-group"><label className="gf-form-label">Gym name</label><input className="gf-input" name="name" placeholder="e.g. Summit Fitness" required /></div>
        <div className="gf-form-group"><label className="gf-form-label">Subdomain</label><input className="gf-input" name="slug" placeholder="summit" required /></div>
      </div>
      <div className="frow">
        <div className="gf-form-group"><label className="gf-form-label">City</label><input className="gf-input" name="city" placeholder="Lagos" /></div>
        <div className="gf-form-group"><label className="gf-form-label">Plan</label><select className="gf-select" name="plan">{PLAN_OPTIONS.map((p) => <option key={p.tier} value={p.tier}>{p.label}</option>)}</select></div>
      </div>
      <div className="frow">
        <div className="gf-form-group"><label className="gf-form-label">Owner name</label><input className="gf-input" name="owner_name" placeholder="Owner full name" /></div>
        <div className="gf-form-group"><label className="gf-form-label">Owner email</label><input className="gf-input" type="email" name="owner_email" placeholder="owner@gym.ng" /></div>
      </div>
      {state.error && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '0 0 12px' }}><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      {state.ok && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-brand)', fontSize: '0.84rem', margin: '0 0 12px' }}><Check size={15} strokeWidth={2.4} /> {state.message}</p>}
      <button className="gf-btn gf-btn-primary" style={{ marginTop: 6 }} type="submit" disabled={pending}>
        <UserPlus strokeWidth={1.9} size={16} /> {pending ? 'Provisioning…' : 'Provision gym'}
      </button>
    </form>
  );
}

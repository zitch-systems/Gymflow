'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Save, AlertCircle, UserRoundCheck } from 'lucide-react';
import { savePlan, type CState } from '@/lib/actions/admin-class';
import { INTERVAL_PRESETS, intervalOf } from '@/lib/plan-duration';
import { fmtNaira } from '@/lib/format';

const INIT: CState = { ok: false, error: null };
type Plan = {
  id?: string; name?: string | null; price?: number | null;
  duration_days?: number | null; duration_months?: number | null; is_active?: boolean | null;
  trainer_addon_enabled?: boolean | null; trainer_addon_price?: number | null;
};

export function PlanForm({ plan }: { plan?: Plan }) {
  const [state, action, pending] = useActionState(savePlan, INIT);
  // Pre-select the matching preset (daily/weekly/monthly/quarterly/yearly) or
  // fall back to "custom" for an unusual stored duration.
  const [period, setPeriod] = useState<string>(
    plan ? intervalOf({ duration_days: plan.duration_days, duration_months: plan.duration_months }) : 'monthly',
  );
  const isCustom = period === 'custom';
  const customCount = plan?.duration_days && plan.duration_days > 0 ? plan.duration_days : plan?.duration_months ?? 1;
  const customUnit = plan?.duration_days && plan.duration_days > 0 ? 'days' : 'months';
  // savePlan validates name ("Plan name is required.") and price ("Enter a
  // valid price.") specifically — tie the error to those two required fields.
  const errorId = 'plan-form-error';

  // Optional private-trainer add-on. Both are controlled so the "members will
  // pay X" line can price the combination as the numbers are typed — the whole
  // point of the field is deciding what to charge, and that's hard to judge
  // from two separate boxes.
  const [trainer, setTrainer] = useState(Boolean(plan?.trainer_addon_enabled));
  const [trainerPrice, setTrainerPrice] = useState(
    plan?.trainer_addon_price != null ? String(plan.trainer_addon_price) : '',
  );
  const [basePrice, setBasePrice] = useState(plan?.price != null ? String(plan.price) : '');
  const baseNum = Number(basePrice) || 0;
  const addonNum = Number(trainerPrice) || 0;

  return (
    <form action={action} className="addmember" aria-busy={pending}>
      {plan?.id && <input type="hidden" name="id" value={plan.id} />}
      <div className="af-grid">
        <label>Plan name<input className="gf-input" name="name" defaultValue={plan?.name ?? ''} placeholder="e.g. Weekly" required aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} /></label>
        <label>Price (₦)<input className="gf-input" type="number" name="price" min="0" step="500" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} required aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} /></label>
        <label>Billing period
          <select className="gf-select" name="interval" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {INTERVAL_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </label>
      </div>
      {isCustom && (
        <div className="af-grid" style={{ marginTop: 12 }}>
          <label>Every<input className="gf-input" type="number" name="custom_count" min="1" step="1" defaultValue={String(customCount)} /></label>
          <label>Unit
            <select className="gf-select" name="custom_unit" defaultValue={customUnit}>
              <option value="days">Days</option>
              <option value="months">Months</option>
            </select>
          </label>
        </div>
      )}
      {/* Optional private-trainer add-on. The price sits on top of the plan
          price rather than replacing it, so a gym can leave every existing plan
          exactly as it is and switch this on where it applies. ₦0 is a real
          answer, not a missing one — it's how a gym bundles the trainer into a
          premium plan at no extra charge. */}
      <fieldset className="af-addon">
        <legend className="af-check" style={{ margin: 0 }}>
          <input type="checkbox" name="trainer_addon_enabled" checked={trainer} onChange={(e) => setTrainer(e.target.checked)} />
          <UserRoundCheck size={15} strokeWidth={1.9} /> Offer a private trainer with this plan
        </legend>
        {trainer ? (
          <div className="af-addon-body">
            <label>Private trainer price (₦)
              <input
                className="gf-input" type="number" name="trainer_addon_price" min="0" step="500"
                value={trainerPrice} onChange={(e) => setTrainerPrice(e.target.value)}
                placeholder="0"
                aria-describedby="trainer-addon-hint"
              />
            </label>
            <p className="gf-form-hint" id="trainer-addon-hint" style={{ margin: '8px 0 0' }}>
              {addonNum > 0
                ? <>Members choose this at checkout and pay <strong>{fmtNaira(baseNum + addonNum)}</strong> instead of {fmtNaira(baseNum)}. Taking it is always optional.</>
                : <>Leave this at ₦0 to include a private trainer in the plan price at no extra charge.</>}
              {' '}You assign the actual trainer from the member&rsquo;s page once they&rsquo;ve paid.
            </p>
          </div>
        ) : (
          <p className="gf-form-hint" style={{ margin: '8px 0 0' }}>
            Members on this plan won&rsquo;t be offered a private trainer at checkout.
          </p>
        )}
      </fieldset>
      <label className="af-check"><input type="checkbox" name="is_active" defaultChecked={plan?.is_active ?? true} /> Active — members can subscribe</label>
      {state.error && <p id={errorId} role="alert" className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="addmember-actions">
        <button className="gf-btn gf-btn-primary" disabled={pending} type="submit"><Save size={16} strokeWidth={2} /> {pending ? 'Saving…' : (plan?.id ? 'Save changes' : 'Create plan')}</button>
        <Link href="/admin/pricing" className="gf-btn gf-btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

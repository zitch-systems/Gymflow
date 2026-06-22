'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Save, AlertCircle } from 'lucide-react';
import { savePlan, type CState } from '@/lib/actions/admin-class';
import { INTERVAL_PRESETS, intervalOf } from '@/lib/plan-duration';

const INIT: CState = { ok: false, error: null };
type Plan = {
  id?: string; name?: string | null; price?: number | null;
  duration_days?: number | null; duration_months?: number | null; is_active?: boolean | null;
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

  return (
    <form action={action} className="addmember">
      {plan?.id && <input type="hidden" name="id" value={plan.id} />}
      <div className="af-grid">
        <label>Plan name<input className="gf-input" name="name" defaultValue={plan?.name ?? ''} placeholder="e.g. Weekly" required /></label>
        <label>Price (₦)<input className="gf-input" type="number" name="price" min="0" step="500" defaultValue={plan?.price != null ? String(plan.price) : ''} required /></label>
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
      <label className="af-check"><input type="checkbox" name="is_active" defaultChecked={plan?.is_active ?? true} /> Active — members can subscribe</label>
      {state.error && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="addmember-actions">
        <button className="gf-btn gf-btn-primary" disabled={pending} type="submit"><Save size={16} strokeWidth={2} /> {pending ? 'Saving…' : (plan?.id ? 'Save changes' : 'Create plan')}</button>
        <Link href="/admin/pricing" className="gf-btn gf-btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

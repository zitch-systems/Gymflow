'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Save, AlertCircle } from 'lucide-react';
import { savePlan, type CState } from '@/lib/actions/admin-class';

const INIT: CState = { ok: false, error: null };
type Plan = { id?: string; name?: string | null; price?: number | null; duration_months?: number | null; is_active?: boolean | null };

export function PlanForm({ plan }: { plan?: Plan }) {
  const [state, action, pending] = useActionState(savePlan, INIT);
  return (
    <form action={action} className="addmember">
      {plan?.id && <input type="hidden" name="id" value={plan.id} />}
      <div className="af-grid">
        <label>Plan name<input className="gf-input" name="name" defaultValue={plan?.name ?? ''} placeholder="e.g. Monthly" required /></label>
        <label>Price (₦)<input className="gf-input" type="number" name="price" min="0" step="500" defaultValue={plan?.price != null ? String(plan.price) : ''} required /></label>
        <label>Duration (months)<input className="gf-input" type="number" name="duration_months" min="1" step="1" defaultValue={plan?.duration_months != null ? String(plan.duration_months) : '1'} required /></label>
      </div>
      <label className="af-check"><input type="checkbox" name="is_active" defaultChecked={plan?.is_active ?? true} /> Active — members can subscribe</label>
      {state.error && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="addmember-actions">
        <button className="gf-btn gf-btn-primary" disabled={pending} type="submit"><Save size={16} strokeWidth={2} /> {pending ? 'Saving…' : (plan?.id ? 'Save changes' : 'Create plan')}</button>
        <Link href="/admin/pricing" className="gf-btn gf-btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

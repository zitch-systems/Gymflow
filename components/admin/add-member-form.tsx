'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { UserPlus, AlertCircle } from 'lucide-react';
import { addMember, type ActionState } from '@/lib/actions/admin-member';

const INIT: ActionState = { ok: false, error: null };
type Plan = { id: string; name: string; price: number };

export function AddMemberForm({ plans }: { plans: Plan[] }) {
  const [state, action, pending] = useActionState(addMember, INIT);
  // addMember validates full_name and phone specifically ("Enter the member's
  // name." / "Enter a valid phone number…") — tie the error to those two.
  const errorId = 'add-member-error';
  return (
    <form action={action} className="addmember" aria-busy={pending}>
      <div className="af-grid">
        <label>Full name *<input name="full_name" className="gf-input" placeholder="e.g. Ada Obi" required aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} /></label>
        <label>Email<input name="email" type="email" className="gf-input" placeholder="ada@email.com" /></label>
        <label>Phone *<input name="phone" type="tel" inputMode="tel" className="gf-input" placeholder="0801 234 5678" required aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} /></label>
        <label>Starting plan (optional)
          <select name="planId" className="gf-input" defaultValue="">
            <option value="">— no membership yet —</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — ₦{Number(p.price).toLocaleString('en-NG')}</option>)}
          </select>
        </label>
      </div>
      <p className="addmember-note">Creates a managed member record. They can be invited to the app later.</p>
      {state.error && <p id={errorId} role="alert" className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="addmember-actions">
        <button className="gf-btn gf-btn-primary" disabled={pending}><UserPlus strokeWidth={1.9} size={16} /> {pending ? 'Adding…' : 'Add member'}</button>
        <Link href="/admin/members" className="gf-btn gf-btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

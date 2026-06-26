'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { UserPlus, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { inviteStaff, type StaffState } from '@/lib/actions/admin-staff';

const INIT: StaffState = { ok: false, error: null };

const ROLES = [
  ['instructor', 'Instructor', 'Classes & their own clients'],
  ['front_desk', 'Front desk', 'Check-in & members'],
  ['manager', 'Manager', 'Everything but billing'],
  ['accountant', 'Accountant', 'Billing & payouts'],
] as const;

export function AddStaffForm() {
  const [state, action, pending] = useActionState(inviteStaff, INIT);

  // Success — show the message and (for a newly-created account) the temp login.
  if (state.ok) {
    return (
      <div className="addmember">
        <p className="act-fb ok"><CheckCircle2 size={16} strokeWidth={2} /> {state.message}</p>
        {state.tempPassword && (
          <div className="staff-creds">
            <div className="staff-cred"><KeyRound size={15} strokeWidth={2} /><span>Temporary password</span><code>{state.tempPassword}</code></div>
            <p className="addmember-note">Share this with the staff member — they sign in at the login page and can change it later. It won&apos;t be shown again.</p>
          </div>
        )}
        <div className="addmember-actions">
          <Link href="/admin/instructors" className="gf-btn gf-btn-primary">Back to staff</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="addmember">
      <div className="af-grid">
        <label>Full name *<input name="full_name" className="gf-input" placeholder="e.g. Tunde Bello" required /></label>
        <label>Email *<input name="email" type="email" className="gf-input" placeholder="tunde@email.com" required /></label>
        <label>Role *
          <select name="role" className="gf-input" defaultValue="instructor" required>
            {ROLES.map(([value, label, desc]) => <option key={value} value={value}>{label} — {desc}</option>)}
          </select>
        </label>
      </div>
      <p className="addmember-note">Creates a sign-in account linked to your gym (or links an existing GymFlow account with this email). Owner &amp; manager only.</p>
      {state.error && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="addmember-actions">
        <button className="gf-btn gf-btn-primary" disabled={pending}><UserPlus strokeWidth={1.9} size={16} /> {pending ? 'Adding…' : 'Add staff'}</button>
        <Link href="/admin/instructors" className="gf-btn gf-btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

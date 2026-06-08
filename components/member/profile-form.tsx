'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Save, AlertCircle } from 'lucide-react';
import { updateMemberProfile, type SaveState } from '@/lib/actions/profile';

const INIT: SaveState = { ok: false, error: null };

type P = {
  full_name?: string | null; phone?: string | null; date_of_birth?: string | null; gender?: string | null;
  address?: string | null; emergency_contact_name?: string | null; emergency_contact_phone?: string | null;
};

export function MemberProfileForm({ profile }: { profile: P }) {
  const [state, action, pending] = useActionState(updateMemberProfile, INIT);
  return (
    <form action={action} className="pform">
      <label className="pf">Full name<input className="gf-input" name="full_name" defaultValue={profile.full_name ?? ''} required /></label>
      <label className="pf">Phone<input className="gf-input" name="phone" defaultValue={profile.phone ?? ''} placeholder="0801 234 5678" /></label>
      <div className="pf-row">
        <label className="pf">Date of birth<input className="gf-input" type="date" name="date_of_birth" defaultValue={profile.date_of_birth ?? ''} /></label>
        <label className="pf">Gender
          <select className="gf-input" name="gender" defaultValue={profile.gender ?? ''}>
            <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="pf">Address<input className="gf-input" name="address" defaultValue={profile.address ?? ''} placeholder="Street, city" /></label>
      <div className="pf-row">
        <label className="pf">Emergency contact<input className="gf-input" name="emergency_contact_name" defaultValue={profile.emergency_contact_name ?? ''} /></label>
        <label className="pf">Emergency phone<input className="gf-input" name="emergency_contact_phone" defaultValue={profile.emergency_contact_phone ?? ''} /></label>
      </div>
      {state.error && <p className="pf-err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="pf-actions">
        <button className="gf-btn gf-btn-primary gf-btn-full" disabled={pending} type="submit"><Save size={16} strokeWidth={2} /> {pending ? 'Saving…' : 'Save changes'}</button>
        <Link href="/dashboard/profile" className="gf-btn gf-btn-secondary gf-btn-full" style={{ textDecoration: 'none' }}>Cancel</Link>
      </div>
    </form>
  );
}

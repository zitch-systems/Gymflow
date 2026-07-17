'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { UserPlus, AlertCircle, CheckCircle2, KeyRound, Copy, Check } from 'lucide-react';
import { inviteStaff, type StaffState } from '@/lib/actions/admin-staff';

const INIT: StaffState = { ok: false, error: null };

// Copy text to the clipboard, with a document.execCommand fallback for
// browsers / contexts where the async Clipboard API is unavailable.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function CopyButton({ value, label, small }: { value: string; label: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`gf-btn gf-btn-secondary${small ? ' gf-btn-sm' : ''}`}
      onClick={async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? <><Check size={14} strokeWidth={2.4} /> Copied</> : <><Copy size={14} strokeWidth={2} /> {label}</>}
    </button>
  );
}

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
            {state.email && (
              <div className="staff-cred"><KeyRound size={15} strokeWidth={2} /><span>Email</span><code>{state.email}</code></div>
            )}
            <div className="staff-cred" style={{ marginTop: state.email ? 8 : 0 }}>
              <KeyRound size={15} strokeWidth={2} /><span>Temporary password</span><code>{state.tempPassword}</code>
            </div>
            <div className="staff-cred-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <CopyButton value={state.tempPassword} label="Copy password" small />
              {state.email && (
                <CopyButton value={`Email: ${state.email}\nPassword: ${state.tempPassword}`} label="Copy login details" small />
              )}
            </div>
            <p className="addmember-note">Share these with the staff member — they sign in at the login page and can change the password later. It won&apos;t be shown again.</p>
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

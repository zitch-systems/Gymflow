'use client';

import { useActionState } from 'react';
import { ScanLine, Check, LogOut } from 'lucide-react';
import { manualCheckIn, manualCheckOut, type ActionState } from '@/lib/actions/admin-member';

const INIT: ActionState = { ok: false, error: null };

// Check-in / check-out toggle for a search result row: members currently
// inside (open visit today) get "Check out", everyone else "Check in".
export function CheckInButton({ memberId, checkedIn = false }: { memberId: string; checkedIn?: boolean }) {
  const [state, action, pending] = useActionState(checkedIn ? manualCheckOut : manualCheckIn, INIT);
  if (state.ok) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--gf-success)', fontFamily: 'var(--gf-font-display)', fontWeight: 700, fontSize: '0.8rem' }}>
        <Check size={14} strokeWidth={2.6} /> {state.message ?? (checkedIn ? 'Checked out' : 'Checked in')}
      </span>
    );
  }
  return (
    <form action={action} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="hidden" name="memberId" value={memberId} />
      <button className={`gf-btn ${checkedIn ? 'gf-btn-secondary' : 'gf-btn-primary'} gf-btn-sm`} disabled={pending} type="submit">
        {checkedIn ? <LogOut size={14} strokeWidth={2} /> : <ScanLine size={14} strokeWidth={2} />} {pending ? '…' : checkedIn ? 'Check out' : 'Check in'}
      </button>
      {state.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.74rem' }}>{state.error}</span>}
    </form>
  );
}

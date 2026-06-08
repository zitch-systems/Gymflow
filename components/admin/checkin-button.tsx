'use client';

import { useActionState } from 'react';
import { ScanLine, Check } from 'lucide-react';
import { manualCheckIn, type ActionState } from '@/lib/actions/admin-member';

const INIT: ActionState = { ok: false, error: null };

export function CheckInButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState(manualCheckIn, INIT);
  if (state.ok) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--gf-success)', fontFamily: 'var(--gf-font-display)', fontWeight: 700, fontSize: '0.8rem' }}>
        <Check size={14} strokeWidth={2.6} /> Checked in
      </span>
    );
  }
  return (
    <form action={action} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="hidden" name="memberId" value={memberId} />
      <button className="gf-btn gf-btn-primary gf-btn-sm" disabled={pending} type="submit"><ScanLine size={14} strokeWidth={2} /> {pending ? '…' : 'Check in'}</button>
      {state.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.74rem' }}>{state.error}</span>}
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { setGymCommission, type CommissionState } from '@/lib/actions/platform-gym';

const INIT: CommissionState = { ok: false, error: null };

// Inline per-gym commission editor for the superadmin gym table. Platform
// operators only (the action is requirePlatformAdmin-gated).
export function CommissionEditor({ gymId, pct }: { gymId: string; pct: number }) {
  const [state, action, pending] = useActionState(setGymCommission, INIT);
  return (
    <form action={action} className="commission-edit" title={state.error ?? undefined}>
      <input type="hidden" name="gymId" value={gymId} />
      <input
        type="number" name="pct" min="0" max="100" step="0.1" defaultValue={pct}
        aria-label="Platform commission percent" disabled={pending}
      />
      <span className="pct">%</span>
      <button type="submit" className="save" disabled={pending} aria-label="Save commission">
        {state.error ? <AlertCircle size={13} strokeWidth={2.2} /> : <Check size={13} strokeWidth={2.4} />}
      </button>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import Image from 'next/image';
import { Building2, ArrowRight, AlertCircle } from 'lucide-react';
import { completeSetup, type AuthState } from '@/lib/auth/actions';

const initial: AuthState = { error: null };

// Shown by /launch when a signed-in account has no gym yet (legacy signup or
// failed provisioning). One field → completeSetup → /launch → /admin.
export function FinishSetup({ defaultGymName }: { defaultGymName?: string }) {
  const [state, action, pending] = useActionState(completeSetup, initial);

  return (
    <div className="auth-shell" style={{ gridTemplateColumns: '1fr' }}>
      <main className="formside">
        <div className="formcard">
          <span className="brand" style={{ display: 'inline-flex' }}>
            <Image src="/images/logomark-v3.svg" alt="" width={30} height={30} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </span>
          <h1>One last step</h1>
          <p className="lede">Your account is ready — name your gym and we&apos;ll set up your workspace.</p>

          <form action={action}>
            <div className="field gf-form-group">
              <label className="gf-form-label">Gym name</label>
              <div className="gf-input-group">
                <Building2 className="gf-input-icon" strokeWidth={1.75} />
                <input className="gf-input" name="gym" placeholder="e.g. Powerhouse Fitness" defaultValue={defaultGymName ?? ''} required autoFocus />
              </div>
            </div>
            {state.error && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '0 0 14px' }}>
                <AlertCircle size={15} strokeWidth={2} /> {state.error}
              </p>
            )}
            <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={pending}>
              {pending ? 'Setting up…' : 'Create my workspace'} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

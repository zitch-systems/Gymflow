'use client';

import { useActionState } from 'react';
import { AlertCircle, ArrowRight, Globe, Lock, Mail, ShieldCheck } from 'lucide-react';
import { signIn, type AuthState } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';
import { PasswordInput } from '@/components/ui/password-input';

const initial: AuthState = { error: null };

// One form, two fields, nothing else.
//
// It posts to the same signIn action the rest of the app uses, on purpose: that
// action owns the per-IP and per-email rate limits, the second-factor challenge
// (which every platform admin is subject to), and the friendly wording for an
// unconfirmed or wrong-password sign-in. A bespoke action here would be a
// second copy of all of it, and the copy that quietly drifts is always the one
// guarding the account that can read every tenant's data.
//
// After a correct password, signIn redirects to /launch, which routes a
// platform admin to the console — and anyone else to their own surface, which
// is the honest outcome for a gym account typed into this box.
export function ConsoleLogin({ denied }: { denied: boolean }) {
  const [state, action, pending] = useActionState(signIn, initial);
  const errorId = 'console-auth-error';

  return (
    <main className="ds-admin" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--gf-bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <LogoMark size={32} className="mark-md" />
          <span style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 800, fontSize: '1.05rem' }}>Gym<em style={{ color: 'var(--gf-brand)', fontStyle: 'normal' }}>Flow</em></span>
          <span className="pill-plat" style={{ marginLeft: 'auto' }}><Globe size={12} strokeWidth={2} /> Platform</span>
        </div>

        <h1 style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.5rem', fontWeight: 800, margin: '0 0 6px' }}>Platform console</h1>
        <p style={{ color: 'var(--gf-text-secondary)', fontSize: '0.88rem', margin: '0 0 22px' }}>
          Sign in with your GymFlow platform admin account.
        </p>

        {denied && (
          // The account signed in fine — it just isn't on the platform-admin
          // list. Naming the cause matters: the usual one is being signed in on
          // a gym account, and no amount of retrying that account will work.
          <p role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--gf-warning-soft)', border: '1px solid var(--gf-warning)', color: 'var(--gf-warning)', borderRadius: 'var(--gf-radius-sm)', padding: '11px 13px', fontSize: '0.83rem', margin: '0 0 18px' }}>
            <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>That account isn’t a platform admin. The account you use for a gym won’t open this console — sign in with the platform one.</span>
          </p>
        )}

        <form action={action}>
          <div className="field gf-form-group">
            <label className="gf-form-label" htmlFor="console-email">Email</label>
            <div className="gf-input-group">
              <Mail className="gf-input-icon" strokeWidth={1.75} />
              <input
                className="gf-input" id="console-email" name="email" type="email"
                autoComplete="username" placeholder="you@gymflow.ng" required autoFocus
                aria-invalid={state.error ? true : undefined}
                aria-describedby={state.error ? errorId : undefined}
              />
            </div>
          </div>

          <div className="field gf-form-group" style={{ marginBottom: 18 }}>
            <label className="gf-form-label" htmlFor="console-password">Password</label>
            <div className="gf-input-group">
              <Lock className="gf-input-icon" strokeWidth={1.75} />
              <PasswordInput
                className="gf-input" id="console-password" name="password"
                autoComplete="current-password" placeholder="••••••••" required
                aria-invalid={state.error ? true : undefined}
                aria-describedby={state.error ? errorId : undefined}
              />
            </div>
          </div>

          {state.error && (
            <p id={errorId} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '0 0 14px' }}>
              <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0 }} /> {state.error}
            </p>
          )}

          <button type="submit" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" disabled={pending}>
            {pending ? 'Signing in…' : <>Sign in <ArrowRight size={17} strokeWidth={2} /></>}
          </button>
        </form>

        <p style={{ display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center', color: 'var(--gf-text-muted)', fontSize: '0.76rem', marginTop: 20 }}>
          <ShieldCheck size={13} strokeWidth={1.9} /> Protected by two-step sign-in
        </p>
      </div>
    </main>
  );
}

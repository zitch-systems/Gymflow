'use client';

import { useActionState, useState, useTransition } from 'react';
import { signIn, requestPasswordReset } from '@/lib/auth/actions';
import { useToast } from '@/lib/toast';

export function LoginForm({ redirectTo, slug }: { redirectTo: string; slug: string }) {
  const [state, formAction, pending] = useActionState(signIn, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [resetPending, startResetTransition] = useTransition();
  const toast = useToast();

  return (
    <>
      {state?.error && (
        <div className="error-msg show" style={{ marginBottom: 16 }} role="alert">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{state.error}</span>
        </div>
      )}

      <form action={formAction} className="form-stack" noValidate>
        <input type="hidden" name="redirect" value={redirectTo} />
        <input type="hidden" name="slug" value={slug} />

        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="email">Email</label>
          <div className="gf-input-group">
            <svg className="gf-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <input
              type="email"
              id="email"
              name="email"
              className="gf-input"
              placeholder="you@gym.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="password">Password</label>
          <div className="pw-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              name="password"
              className="gf-input"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label="Toggle password visibility"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {showPassword ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        <div className="auth-row">
          <label>
            <input type="checkbox" name="remember" defaultChecked style={{ accentColor: 'var(--gf-brand)' }} />
            Remember me
          </label>
          <button
            type="button"
            className="forgot-link"
            disabled={resetPending}
            onClick={() => {
              if (!email) {
                toast('Enter your email first', 'warning');
                return;
              }
              startResetTransition(async () => {
                const res = await requestPasswordReset(email, window.location.origin);
                if (res.error) toast(res.error, 'error');
                else toast('Password reset link sent — check your email', 'success');
              });
            }}
          >
            {resetPending ? 'Sending…' : 'Forgot password?'}
          </button>
        </div>

        <button type="submit" disabled={pending} className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">
          {pending ? (
            <>
              <span>Signing in…</span>
              <span className="gf-spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
            </>
          ) : (
            <>
              <span>Sign in</span>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
              </svg>
            </>
          )}
        </button>
      </form>
    </>
  );
}

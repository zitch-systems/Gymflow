'use client';

import { useState, useTransition } from 'react';
import { Mail, KeyRound, MailCheck } from 'lucide-react';
import { requestPasswordReset } from '@/lib/auth/actions';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <>
        <div className="auth-done">
          <div className="ring" aria-hidden><MailCheck strokeWidth={1.9} /></div>
          <h1>Check your email</h1>
          <p className="lede">
            If an account exists for <span className="em">{email}</span>, we&rsquo;ve sent a link to reset your password. It expires in an hour.
          </p>
        </div>
        {/* Recovery affordance from the prototype — Resend + contact support. */}
        <p className="resend">
          Didn&rsquo;t get it?{' '}
          <button
            type="button"
            className="gf-link"
            disabled={pending}
            onClick={() => {
              start(async () => {
                await requestPasswordReset(email, window.location.origin);
              });
            }}
          >
            {pending ? 'Resending…' : 'Resend email'}
          </button>{' '}
          · <a href="mailto:hello@gymflow.ng">Contact support</a>
        </p>
      </>
    );
  }

  return (
    <>
      <span className="lock-badge"><KeyRound strokeWidth={1.9} /></span>
      <h1>Forgot your password?</h1>
      <p className="lede">No worries — enter the email on your GymFlow account and we&rsquo;ll send a link to reset it.</p>

      {error && <div className="error-msg show" role="alert" style={{ marginBottom: 14 }}><span>{error}</span></div>}

      <form
        className="form-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!email) { setError('Enter your email first.'); return; }
          setError(null);
          start(async () => {
            const res = await requestPasswordReset(email, window.location.origin);
            if (res.error) setError(res.error);
            else setSent(true);
          });
        }}
      >
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="email">Email address</label>
          <div className="gf-input-group">
            <Mail className="gf-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="email"
              type="email"
              className="gf-input"
              placeholder="you@yourgym.ng"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" disabled={pending} className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">
          {pending ? 'Sending…' : (
            <>
              <span>Send reset link</span>
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

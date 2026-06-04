'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, Check } from 'lucide-react';
import { requestPasswordReset } from '@/lib/auth/actions';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <div className="login-card">
        <div className="mk-cform-done">
          <div className="mk-cform-check" aria-hidden><Check size={32} strokeWidth={2.5} /></div>
          <h2>Check your email</h2>
          <p>If an account exists for <strong>{email}</strong>, we’ve sent a link to reset your password. It expires in an hour.</p>
        </div>
        <Link href="/login" className="gf-btn gf-btn-secondary gf-btn-full" style={{ marginTop: 16 }}>
          <ArrowLeft size={16} strokeWidth={2} /> Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="login-card">
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
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" disabled={pending} className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </div>
  );
}

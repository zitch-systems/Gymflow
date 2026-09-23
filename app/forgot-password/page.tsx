'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, ArrowRight, Lock, AlertCircle } from 'lucide-react';
import { requestPasswordReset } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';

// revamp/forgot-password.html — request → "check your email" two-step flow,
// wired to the requestPasswordReset server action.
export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Stable id tying the server error to the one input it can be about (WCAG 3.3.1/4.1.2).
  const errorId = 'forgot-password-error';

  async function handle(formData: FormData) {
    setPending(true);
    setErr(null);
    const res = await requestPasswordReset({ error: null }, formData);
    setPending(false);
    if (res.error) setErr(res.error);
    else setSent(true);
  }

  return (
    <div className="auth-shell">
      <aside className="brandside">
        <div className="brandside-bg" aria-hidden />
        <Link className="brand" href="/">
          <LogoMark size={38} className="mark-md" />
          <span className="brand-tx lg">Gym<em>Flow</em></span>
        </Link>
        <div className="bs-quote">
          <span className="lock-badge"><Lock strokeWidth={1.75} /></span>
          <p style={{ marginTop: 18 }}>Account recovery, the simple way.</p>
        </div>
      </aside>

      <main id="main-content" className="formside">
        <div className="formcard">
          <Link className="brand" href="/" style={{ display: 'inline-flex' }}>
            <LogoMark size={30} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>

          {!sent ? (
            <>
              <h1>Forgot your password?</h1>
              <p className="lede">No worries — enter the email on your GymFlow account and we&apos;ll send a link to reset it.</p>
              <form action={handle} aria-busy={pending}>
                <div className="field gf-form-group">
                  <label className="gf-form-label" htmlFor="forgot-email">Email</label>
                  <div className="gf-input-group">
                    <Mail className="gf-input-icon" strokeWidth={1.75} />
                    <input className="gf-input" id="forgot-email" type="email" name="email" autoComplete="email" placeholder="you@yourgym.ng" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={err ? true : undefined} aria-describedby={err ? errorId : undefined} />
                  </div>
                </div>
                {err && <p id={errorId} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '-4px 0 14px' }}><AlertCircle size={15} strokeWidth={2} /> {err}</p>}
                <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={pending}>
                  {pending ? 'Sending…' : 'Send reset link'} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
                </button>
              </form>
            </>
          ) : (
            <div className="auth-done" role="status">
              <div className="ring"><Mail strokeWidth={1.75} /></div>
              <h1>Check your email</h1>
              <p className="lede">We sent a password reset link to <span className="em">{email || 'your email'}</span>. It expires in 30 minutes.</p>
              <p className="resend">
                Didn&apos;t get it?{' '}
                <button type="button" className="linkish" onClick={() => setSent(false)}>Resend email</button>
                {' · '}<a href="mailto:hello@gymflow.ng">Contact support</a>
              </p>
            </div>
          )}

          <Link href="/login" className="back-link"><ArrowLeft strokeWidth={1.75} /> Back to sign in</Link>
        </div>
      </main>
    </div>
  );
}

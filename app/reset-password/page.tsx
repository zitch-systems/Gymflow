'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Lock, Check, ArrowRight } from 'lucide-react';

// revamp/reset-password.html — set-password with a live strength meter +
// requirement checklist, then a "password updated" success state.
const REQS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'An uppercase & lowercase letter', test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'A number', test: (p: string) => /\d/.test(p) },
  { label: 'A symbol', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ResetPasswordPage() {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const score = useMemo(() => REQS.reduce((n, r) => n + (r.test(pw) ? 1 : 0), 0), [pw]);
  const matchHint = confirm.length === 0 ? '' : pw === confirm ? 'Passwords match.' : 'Passwords don’t match yet.';
  const canSubmit = score === 4 && pw === confirm;

  return (
    <div className="auth-shell">
      <aside className="brandside">
        <div className="brandside-bg" aria-hidden />
        <Link className="brand" href="/">
          <Image src="/images/logomark-v2.svg" alt="" width={38} height={38} className="mark-md" priority />
          <span className="brand-tx lg">Gym<em>Flow</em></span>
        </Link>
        <div className="bs-quote">
          <span className="lock-badge"><Lock strokeWidth={1.75} /></span>
          <p style={{ marginTop: 18 }}>Choose something strong you&apos;ll remember.</p>
        </div>
      </aside>

      <main className="formside">
        <div className="formcard">
          <Link className="brand" href="/" style={{ display: 'inline-flex' }}>
            <Image src="/images/logomark-v2.svg" alt="" width={30} height={30} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>

          {!done ? (
            <>
              <h1>Set a new password</h1>
              <p className="lede">Resetting for <span className="em">adunni@powerhouse.ng</span>. Choose something strong you&apos;ll remember.</p>

              <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) setDone(true); }}>
                <div className="field gf-form-group">
                  <label className="gf-form-label">New password</label>
                  <div className="gf-input-group">
                    <Lock className="gf-input-icon" strokeWidth={1.75} />
                    <input className="gf-input" type="password" placeholder="••••••••" value={pw} onChange={(e) => setPw(e.target.value)} required />
                  </div>
                </div>

                <div className={`pw-meter s${score}`}><span /><span /><span /><span /></div>
                <div className="pw-hint">Use 8+ characters with a mix of letters, numbers &amp; symbols.</div>

                <ul className="pw-reqs">
                  {REQS.map((r) => {
                    const ok = r.test(pw);
                    return (
                      <li key={r.label} className={ok ? 'ok' : undefined}>
                        <Check strokeWidth={2.4} /> {r.label}
                      </li>
                    );
                  })}
                </ul>

                <div className="field gf-form-group">
                  <label className="gf-form-label">Confirm password</label>
                  <div className="gf-input-group">
                    <Lock className="gf-input-icon" strokeWidth={1.75} />
                    <input className="gf-input" type="password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                  </div>
                </div>
                <div className="pw-hint" style={{ margin: '6px 0 18px', minHeight: 16, color: matchHint.startsWith('Passwords match') ? 'var(--gf-brand)' : 'var(--gf-text-muted)' }}>
                  {matchHint}
                </div>

                <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={!canSubmit}>
                  Update password <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
                </button>
              </form>
            </>
          ) : (
            <div className="auth-done">
              <div className="ring"><Check strokeWidth={2.4} /></div>
              <h1>Password updated</h1>
              <p className="lede">Your password has been changed. You can now sign in with your new password.</p>
              <Link href="/login" className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" style={{ marginTop: 18 }}>
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, Check, ArrowRight, AlertCircle } from 'lucide-react';
import { updatePassword } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';
import { PasswordInput } from '@/components/ui/password-input';

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
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const score = useMemo(() => REQS.reduce((n, r) => n + (r.test(pw) ? 1 : 0), 0), [pw]);
  const matchHint = confirm.length === 0 ? '' : pw === confirm ? 'Passwords match.' : 'Passwords don’t match yet.';
  const canSubmit = score === 4 && pw === confirm;

  // Stable ids for aria-describedby (WCAG 3.3.1/4.1.2): the strength hint and
  // match hint are always relevant to their fields, the server error joins in
  // only while it's showing.
  const pwHintId = 'pw-strength-hint';
  const confirmHintId = 'confirm-pw-hint';
  const errorId = 'reset-password-error';
  const pwDescribedBy = [pwHintId, err ? errorId : null].filter(Boolean).join(' ');
  const confirmDescribedBy = [confirmHintId, err ? errorId : null].filter(Boolean).join(' ');

  async function handle(formData: FormData) {
    setPending(true);
    setErr(null);
    // updatePassword redirects to /login?reset=1 on success; only returns on error.
    const res = await updatePassword({ error: null }, formData);
    setPending(false);
    if (res?.error) setErr(res.error);
    else setDone(true);
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
          <p style={{ marginTop: 18 }}>Choose something strong you&apos;ll remember.</p>
        </div>
      </aside>

      <main id="main-content" className="formside">
        <div className="formcard">
          <Link className="brand" href="/" style={{ display: 'inline-flex' }}>
            <LogoMark size={30} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>

          {!done ? (
            <>
              <h1>Set a new password</h1>
              <p className="lede">Enter a new password below. Use something strong you&apos;ll remember.</p>

              <form action={handle} aria-busy={pending}>
                <div className="field gf-form-group">
                  <label className="gf-form-label">New password</label>
                  <div className="gf-input-group">
                    <Lock className="gf-input-icon" strokeWidth={1.75} />
                    <PasswordInput className="gf-input" name="password" placeholder="••••••••" value={pw} onChange={(e) => setPw(e.target.value)} required aria-invalid={err ? true : undefined} aria-describedby={pwDescribedBy} />
                  </div>
                </div>

                {/* The bar itself (these 4 spans) stays purely visual — CSS keys
                    .pw-meter.sN span:nth-child(...) off their exact position, so
                    nothing gets added inside it. The live "N of 4" readout lives
                    in a separate, visually-hidden status node right after it, so
                    screen reader users get the same feedback sighted users get
                    from watching the bar fill in, without touching the bar's DOM. */}
                <div className={`pw-meter s${score}`}><span /><span /><span /><span /></div>
                <p role="status" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
                  Password strength: {score} of {REQS.length} requirements met.
                </p>
                <div className="pw-hint" id={pwHintId}>Use 8+ characters with a mix of letters, numbers &amp; symbols.</div>

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
                    <PasswordInput className="gf-input" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} required aria-invalid={err ? true : undefined} aria-describedby={confirmDescribedBy} />
                  </div>
                </div>
                {/* aria-live announces the match/mismatch verdict as it updates;
                    the div is always in the DOM (even while empty) so the live
                    region is registered before the first text change. */}
                <div className="pw-hint" id={confirmHintId} aria-live="polite" style={{ margin: '6px 0 18px', minHeight: 16, color: matchHint.startsWith('Passwords match') ? 'var(--gf-brand)' : 'var(--gf-text-muted)' }}>
                  {matchHint}
                </div>

                {err && <p id={errorId} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '0 0 14px' }}><AlertCircle size={15} strokeWidth={2} /> {err}</p>}

                <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={!canSubmit || pending}>
                  {pending ? 'Updating…' : 'Update password'} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
                </button>
              </form>
            </>
          ) : (
            <div className="auth-done" role="status">
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

'use client';

import { useActionState, useState } from 'react';
import { Lock, CircleCheck, Circle } from 'lucide-react';
import { updatePassword } from '@/lib/auth/actions';

// Per-rule checks — drive both the strength meter and the requirement list.
function checks(pw: string) {
  return {
    len: pw.length >= 8,
    case: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    num: /\d/.test(pw),
    sym: /[^A-Za-z0-9]/.test(pw),
  };
}
function score(c: ReturnType<typeof checks>): number {
  return Object.values(c).filter(Boolean).length;
}

// 0 (empty) + 1–4 (one-per-rule met). Index 0 is the hint shown when the field
// is empty, so the messages align with the meter's bar count.
const LABELS = [
  'Use 8+ characters with a mix of letters, numbers & symbols.',
  'Very weak password',
  'Weak password',
  'Fair password',
  'Good password',
  'Strong password',
];

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const c = checks(pw);
  const s = score(c);
  const mismatch = confirm.length > 0 && confirm !== pw;
  const ready = s === 4 && pw.length > 0 && confirm === pw;

  return (
    <>
      {state?.error && <div className="error-msg show" role="alert" style={{ marginBottom: 14 }}><span>{state.error}</span></div>}
      <form action={action} className="form-stack">
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="password">New password</label>
          <div className="gf-input-group">
            <Lock className="gf-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="password"
              name="password"
              type="password"
              className="gf-input"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={8}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>
          {/* Strength meter — 4 bars, fills as rules are met (className-based per prototype). */}
          <div className={`pw-meter${pw ? ` s${s}` : ''}`} aria-hidden>
            <span /><span /><span /><span />
          </div>
          <div className="pw-hint">{LABELS[pw ? s + 1 : 0]}</div>
          {/* Requirement checklist — every rule must tick before Submit enables. */}
          <ul className="pw-reqs">
            <li className={c.len ? 'ok' : ''}>{c.len ? <CircleCheck size={15} strokeWidth={2.2} /> : <Circle size={15} strokeWidth={2.2} />} At least 8 characters</li>
            <li className={c.case ? 'ok' : ''}>{c.case ? <CircleCheck size={15} strokeWidth={2.2} /> : <Circle size={15} strokeWidth={2.2} />} Upper &amp; lower case letters</li>
            <li className={c.num ? 'ok' : ''}>{c.num ? <CircleCheck size={15} strokeWidth={2.2} /> : <Circle size={15} strokeWidth={2.2} />} A number</li>
            <li className={c.sym ? 'ok' : ''}>{c.sym ? <CircleCheck size={15} strokeWidth={2.2} /> : <Circle size={15} strokeWidth={2.2} />} A symbol (!@#$…)</li>
          </ul>
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="confirm">Confirm password</label>
          <div className="gf-input-group">
            <Lock className="gf-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="confirm"
              name="confirm"
              type="password"
              className="gf-input"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {confirm.length > 0 && (
            <small className="pw-hint" style={{ color: mismatch ? 'var(--gf-text-muted)' : 'var(--gf-brand)' }}>
              {mismatch ? 'Passwords don’t match yet' : '✓ Passwords match'}
            </small>
          )}
        </div>

        <button
          type="submit"
          disabled={pending || !ready}
          className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg"
        >
          {pending ? 'Updating…' : 'Reset password'}
        </button>
      </form>
    </>
  );
}

'use client';

import { useActionState, useState } from 'react';
import { Lock } from 'lucide-react';
import { updatePassword } from '@/lib/auth/actions';

// 0–4 strength score: length, mixed case, a digit, a symbol.
function score(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

const LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const s = score(pw);
  const mismatch = confirm.length > 0 && confirm !== pw;

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
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              minLength={8}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>
          {pw && (
            <div className="pw-meter" data-score={s} aria-hidden>
              <span /><span /><span /><span />
              <small>{LABELS[s]}</small>
            </div>
          )}
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
              placeholder="Re-enter your new password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {mismatch && <small className="pw-mismatch">Passwords don’t match.</small>}
        </div>

        <button
          type="submit"
          disabled={pending || mismatch || s < 2 || confirm.length === 0}
          className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg"
        >
          {pending ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </>
  );
}

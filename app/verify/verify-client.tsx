'use client';

import { useActionState, useId } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ArrowRight, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
import { resendTwoFactor, verifyTwoFactor, type TwoFactorState } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';

const initial: TwoFactorState = { error: null };

// Code entry for the staff second factor — same auth shell as /login and
// /forgot-password, because this is the same sign-in one step further along,
// not a separate product surface.
export function VerifyClient({ maskedEmail }: { maskedEmail: string }) {
  const [state, action, pending] = useActionState(verifyTwoFactor, initial);
  const [resendState, resendAction, resendPending] = useActionState(resendTwoFactor, initial);
  const errorId = useId();

  // Either action can raise an error; the newest message wins so nobody is
  // reading advice about a code they already replaced.
  const error = state.error ?? resendState.error;

  return (
    <div className="auth-shell">
      <aside className="brandside">
        <div className="brandside-bg" aria-hidden />
        <Link className="brand" href="/">
          <LogoMark size={38} className="mark-md" />
          <span className="brand-tx lg">Gym<em>Flow</em></span>
        </Link>
        <div className="bs-quote">
          <span className="lock-badge"><ShieldCheck strokeWidth={1.75} /></span>
          <p style={{ marginTop: 18 }}>Two steps, because your console holds member data and payouts.</p>
        </div>
      </aside>

      <main id="main-content" className="formside">
        <div className="formcard">
          <Link className="brand" href="/" style={{ display: 'inline-flex' }}>
            <LogoMark size={30} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>

          <h1>Verify it’s you</h1>
          <p className="lede">
            We emailed a 6-digit code to <span className="em">{maskedEmail}</span>. Enter it to finish signing in — it expires in 10 minutes.
          </p>

          <form action={action} aria-busy={pending}>
            <div className="field gf-form-group">
              <label className="gf-form-label" htmlFor="code">Verification code</label>
              <div className="gf-input-group">
                <KeyRound className="gf-input-icon" strokeWidth={1.75} />
                <input
                  className="gf-input"
                  id="code"
                  name="code"
                  // autoComplete="one-time-code" is what lets iOS/Android offer
                  // the code straight from the notification; inputMode keeps
                  // the numeric keypad up on phones.
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123456"
                  required
                  autoFocus
                  style={{ letterSpacing: '0.3em' }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                />
              </div>
            </div>

            <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', margin: '-2px 0 16px' }}>
              <input type="checkbox" name="trust" style={{ accentColor: 'var(--gf-brand)' }} />
              Trust this device for 30 days
            </label>

            {error && (
              <p id={errorId} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '-4px 0 14px' }}>
                <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0 }} /> {error}
              </p>
            )}
            {resendState.sent && !error && (
              <p role="status" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-success, #11d18b)', fontSize: '0.84rem', margin: '-4px 0 14px' }}>
                <MailCheck size={15} strokeWidth={2} style={{ flexShrink: 0 }} /> A new code is on its way.
              </p>
            )}

            <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={pending}>
              {pending ? 'Verifying…' : 'Verify and sign in'} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
            </button>
          </form>

          {/* The resend needs its own form — a second submit inside the verify
              form would post the typed code to the resend action. A <div>, not
              the usual <p class="resend">: a form inside a paragraph is invalid
              nesting and the browser would close the <p> early. */}
          <div className="resend" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>Didn’t get it?</span>
            <form action={resendAction}>
              <button type="submit" className="linkish" disabled={resendPending}>
                {resendPending ? 'Sending…' : 'Send a new code'}
              </button>
            </form>
            <span aria-hidden>·</span><a href="mailto:hello@gymflow.ng">Contact support</a>
          </div>

          <p style={{ color: 'var(--gf-text-muted)', fontSize: '0.78rem', lineHeight: 1.5, margin: '14px 0 0' }}>
            Didn’t expect this? Someone entered your password. Don’t enter the code — reset your password and tell your gym owner.
          </p>

          <Link href="/login" className="back-link"><ArrowLeft strokeWidth={1.75} /> Back to sign in</Link>
        </div>
      </main>
    </div>
  );
}

'use client';

import type { CSSProperties } from 'react';
import { useState, useTransition, useActionState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, Lock, ArrowRight, Users, AlertCircle, MailCheck, CheckCircle2, Dumbbell, CalendarCheck, QrCode, UserPlus } from 'lucide-react';
import { signIn, signUp, resendConfirmation, type AuthState } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';
import { PasswordInput } from '@/components/ui/password-input';

const initial: AuthState = { error: null };

export type LoginNotice = 'check-email' | 'confirmed' | 'reset' | 'link-expired' | 'platform-denied' | null;

// Branding for a gym subdomain sign-in (<slug>.gymflow.ng/login). When present,
// the login screen is the gym's own member sign-in, not the platform login.
export type LoginGym = {
  name: string; slug: string; logo_url: string | null; tagline: string | null; brand_color: string | null;
};

const NOTICES: Record<NonNullable<LoginNotice>, { tone: 'info' | 'success' | 'error'; text: string }> = {
  // Signup no longer self-confirms: the gym is created when the link is
  // clicked, so say that rather than "then sign in" — the link does both.
  'check-email': { tone: 'info', text: 'Almost there — check your email (and spam) for the confirmation link. Your gym is set up the moment you open it.' },
  confirmed: { tone: 'success', text: 'Email confirmed — sign in below.' },
  reset: { tone: 'success', text: 'Password updated — sign in with your new password.' },
  // The /auth/confirm callback bounces here with ?error=link_expired when a
  // confirmation or reset link is stale or already used — say so, otherwise the
  // user lands on a normal login page with no idea why their link didn't work.
  'link-expired': { tone: 'error', text: 'That link has expired or was already used. Request a new one below.' },
  // /superadmin reached while signed in on an account that isn't a platform
  // admin. Names the reason rather than the rule: the usual cause is being
  // signed in on a gym account, and "sign in with the platform account" is the
  // one instruction that resolves it.
  'platform-denied': { tone: 'error', text: 'The platform console needs a GymFlow platform admin account. Sign in with that account below — the one you use for your gym won’t open it.' },
};

// revamp/login.html: brand-split layout, email + password. On the apex it's the
// platform login (Sign in / Create gym tabs). On a gym subdomain
// (gym prop set) it's that gym's member sign-in — no "Create gym",
// with the gym logo, colour, and a "Join <gym>" link for new members.
export function LoginClient({ initialMode = 'in', notice = null, gym = null }: { initialMode?: 'in' | 'up'; notice?: LoginNotice; gym?: LoginGym | null }) {
  const memberMode = !!gym;
  const [mode, setMode] = useState<'in' | 'up'>(initialMode);
  const up = memberMode ? false : mode === 'up';
  const [inState, inAction, inPending] = useActionState(signIn, initial);
  const [upState, upAction, upPending] = useActionState(signUp, initial);
  const state = up ? upState : inState;
  const pending = up ? upPending : inPending;

  // Controlled so the unconfirmed-email resend can reuse what was typed.
  const [email, setEmail] = useState('');
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendPending, startResend] = useTransition();
  function resend() {
    const fd = new FormData();
    fd.set('email', email);
    startResend(async () => {
      const res = await resendConfirmation({ error: null }, fd);
      setResendMsg(res.error ? res.error : 'Confirmation email sent — check your inbox.');
    });
  }

  // Signup-only: both password fields are controlled so the mismatch hint can
  // react as the second one is typed instead of waiting for a round-trip.
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Only complain once there's something to compare — flagging a mismatch
  // against an empty box while someone is still typing is noise.
  const mismatch = up && confirmPassword.length > 0 && password !== confirmPassword;
  const confirmErrorId = 'auth-confirm-password-error';

  const banner = notice ? NOTICES[notice] : null;

  // Stable id for the form-level error message — the server action returns one
  // generic error (not per-field), so every input the error could plausibly be
  // about (gym name / email / password) points aria-describedby at it, and all
  // of them get aria-invalid while it's showing (WCAG 3.3.1 / 4.1.2).
  const authErrorId = 'auth-form-error';

  // Re-tint the split screen to the gym's brand colour when signing in on a
  // gym subdomain, so the primary button and accents match their landing page.
  const brandStyle: CSSProperties | undefined = gym?.brand_color
    ? ({
        '--gf-brand': gym.brand_color,
        '--gf-brand-glow': `color-mix(in srgb, ${gym.brand_color} 32%, transparent)`,
        '--gf-brand-soft': `color-mix(in srgb, ${gym.brand_color} 14%, transparent)`,
      } as CSSProperties)
    : undefined;

  return (
    <>
      <aside className={`brandside${memberMode ? '' : ' brandside--owner'}`} style={brandStyle}>
        <div className={`brandside-bg${memberMode ? '' : ' brandside-bg--owner'}`} aria-hidden>
          {!memberMode && (
            <Image
              className="brandside-photo"
              src="/images/gym-owner-operations.svg"
              alt=""
              fill
              priority
              sizes="(max-width: 860px) 0px, 51vw"
            />
          )}
        </div>
        {memberMode ? (
          <>
            <span className="brand">
              {gym!.logo_url ? (
                <Image src={gym!.logo_url} alt="" width={40} height={40} style={{ borderRadius: 10, objectFit: 'cover' }} />
              ) : (
                <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Dumbbell strokeWidth={1.9} /></span>
              )}
              <span className="brand-tx lg">{gym!.name}</span>
            </span>
            <div className="bs-quote">
              <p style={{ fontSize: '1.15rem' }}>{gym!.tagline || `Your ${gym!.name} membership — in your pocket.`}</p>
              <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: 11 }}><QrCode strokeWidth={1.75} /> Check in with a tap</li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 11 }}><CalendarCheck strokeWidth={1.75} /> Book classes in seconds</li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Users strokeWidth={1.75} /> Manage your membership</li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <Link className="brand" href="/">
              <LogoMark size={38} className="mark-md" />
              <span className="brand-tx lg">Gym<em>Flow</em></span>
            </Link>
            <div className="bs-quote">
              <p style={{ fontSize: '1.15rem' }}>One workspace for the day-to-day work of running a gym.</p>
              <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Dumbbell strokeWidth={1.75} /> Manage memberships and renewals</li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 11 }}><CalendarCheck strokeWidth={1.75} /> Schedule classes and track attendance</li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Users strokeWidth={1.75} /> Give staff role-scoped access</li>
              </ul>
            </div>
          </>
        )}
      </aside>

      <main id="main-content" className="formside" style={brandStyle}>
        <div className="formcard">
          {memberMode ? (
            <span className="brand" style={{ display: 'inline-flex' }}>
              {gym!.logo_url ? (
                <Image src={gym!.logo_url} alt="" width={30} height={30} style={{ borderRadius: 8, objectFit: 'cover' }} />
              ) : (
                <Dumbbell strokeWidth={1.9} style={{ width: 26, height: 26, color: 'var(--gf-brand)' }} />
              )}
              <span className="brand-tx">{gym!.name}</span>
            </span>
          ) : (
            <Link className="brand" href="/" style={{ display: 'inline-flex' }}>
              <LogoMark size={30} className="mark-sm" />
              <span className="brand-tx">Gym<em>Flow</em></span>
            </Link>
          )}
          <h1>{memberMode ? `Welcome to ${gym!.name}` : up ? 'Launch your gym' : 'Welcome back'}</h1>
          <p className="lede">{memberMode ? 'Sign in to your membership.' : up ? 'Create your gym in one step — branded subdomain included.' : "Sign in to your gym's dashboard."}</p>

          {banner && (
            <p role="status" style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, margin: '0 0 16px', padding: '10px 12px',
              borderRadius: 10, fontSize: '0.86rem', lineHeight: 1.45,
              background: banner.tone === 'success' ? 'var(--gf-success-soft, rgba(17,209,139,0.12))'
                : banner.tone === 'error' ? 'var(--gf-danger-soft, rgba(255,69,96,0.12))'
                : 'var(--gf-info-soft, rgba(64,128,255,0.12))',
              color: banner.tone === 'success' ? 'var(--gf-success, #11d18b)'
                : banner.tone === 'error' ? 'var(--gf-danger, #ff4560)'
                : 'var(--gf-info, #4080ff)',
            }}>
              {banner.tone === 'success' ? <CheckCircle2 size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
                : banner.tone === 'error' ? <AlertCircle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
                : <MailCheck size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />}
              {banner.text}
            </p>
          )}

          {!memberMode && (
            // Complete WAI-ARIA tabs pattern: each tab controls the form panel
            // below, only the active tab is in the tab order, and Left/Right
            // arrows move between tabs (previously tabs existed with no panel
            // linkage or keyboard model — a half-implemented pattern).
            <div
              className="tabs" role="tablist" aria-label="Sign in or create a gym"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const next = up ? 'in' : 'up';
                setMode(next);
                const idx = next === 'in' ? 0 : 1;
                (e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[idx])?.focus();
              }}
            >
              <button id="auth-tab-in" className={!up ? 'on' : undefined} onClick={() => setMode('in')} role="tab" aria-selected={!up} aria-controls="auth-panel" tabIndex={!up ? 0 : -1} type="button">Sign in</button>
              <button id="auth-tab-up" className={up ? 'on' : undefined} onClick={() => setMode('up')} role="tab" aria-selected={up} aria-controls="auth-panel" tabIndex={up ? 0 : -1} type="button">Create gym</button>
            </div>
          )}

          <form action={up ? upAction : inAction} aria-busy={pending} {...(!memberMode ? { id: 'auth-panel', role: 'tabpanel' as const, 'aria-labelledby': up ? 'auth-tab-up' : 'auth-tab-in' } : {})}>
            {up && (
              <div className="field gf-form-group">
                <label className="gf-form-label" htmlFor="auth-gym-name">Gym name</label>
                <input className="gf-input" id="auth-gym-name" name="gym" placeholder="e.g. Powerhouse Fitness" required aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? authErrorId : undefined} />
              </div>
            )}
            <div className="field gf-form-group">
              <label className="gf-form-label" htmlFor="auth-email">Email</label>
              <div className="gf-input-group">
                <Mail className="gf-input-icon" strokeWidth={1.75} />
                <input className="gf-input" id="auth-email" type="email" name="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? authErrorId : undefined} />
              </div>
            </div>
            <div className="field gf-form-group">
              <label className="gf-form-label" htmlFor="auth-password">Password</label>
              <div className="gf-input-group">
                <Lock className="gf-input-icon" strokeWidth={1.75} />
                <PasswordInput className="gf-input" id="auth-password" name="password" placeholder="••••••••" required minLength={up ? 8 : undefined} value={up ? password : undefined} onChange={up ? (e) => setPassword(e.target.value) : undefined} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? authErrorId : undefined} />
              </div>
            </div>
            {up && (
              // Confirm-password is signup-only: a typo in the password you're
              // CHOOSING locks you out of an account you can't sign into yet,
              // while a typo when signing in just fails and you retype it.
              // Mismatch is reported here as you type and re-checked in the
              // action, which is the check that actually counts.
              <div className="field gf-form-group">
                <label className="gf-form-label" htmlFor="confirm-password">Confirm password</label>
                <div className="gf-input-group">
                  <Lock className="gf-input-icon" strokeWidth={1.75} />
                  <PasswordInput
                    className="gf-input" id="confirm-password" name="confirm_password"
                    placeholder="••••••••" required minLength={8}
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    aria-invalid={mismatch ? true : undefined}
                    aria-describedby={mismatch ? confirmErrorId : undefined}
                  />
                </div>
                {mismatch && (
                  <p id={confirmErrorId} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gf-danger)', fontSize: '0.8rem', margin: '6px 0 0' }}>
                    <AlertCircle size={14} strokeWidth={2} style={{ flexShrink: 0 }} /> Both passwords must match.
                  </p>
                )}
              </div>
            )}
            {!up && (
              <div className="row">
                <label><input type="checkbox" defaultChecked style={{ accentColor: 'var(--gf-brand)' }} /> Remember me</label>
                <Link href="/forgot-password">Forgot password?</Link>
              </div>
            )}
            {state.error && (
              <p id={authErrorId} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: up ? '0 0 14px' : '-8px 0 14px' }}>
                <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0 }} /> {state.error}
              </p>
            )}
            {!up && inState.code === 'unconfirmed' && (
              // role="status" covers both the resend button's "Sending…" pending
              // text and the outcome message that replaces it — one live region
              // for the whole mini-flow instead of two separate announcements.
              <p role="status" style={{ margin: '-6px 0 14px', fontSize: '0.84rem' }}>
                {resendMsg ? (
                  <span style={{ color: 'var(--gf-success, #11d18b)' }}>{resendMsg}</span>
                ) : (
                  <button type="button" className="linkish" onClick={resend} disabled={resendPending}>
                    {resendPending ? 'Sending…' : 'Resend confirmation email'}
                  </button>
                )}
              </p>
            )}
            <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={pending} style={{ marginTop: up ? 4 : 0 }}>
              {pending ? (up ? 'Creating your gym…' : 'Signing in…') : up ? 'Launch your gym' : 'Sign in'} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
            </button>
          </form>

          <p className="foot-note">
            {memberMode ? (
              <>New to {gym!.name}? <Link className="linkish" href={`/join/${gym!.slug}`}><UserPlus size={14} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 3 }} />Join {gym!.name}</Link></>
            ) : up ? (
              <>Already have a gym? <button type="button" className="linkish" onClick={() => setMode('in')}>Sign in</button></>
            ) : (
              <>New to GymFlow? <button type="button" className="linkish" onClick={() => setMode('up')}>Launch your gym free</button></>
            )}
          </p>
        </div>
      </main>
    </>
  );
}

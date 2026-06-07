'use client';

import { useState, useActionState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Star, Mail, Lock, ArrowRight, Users, Shield, GraduationCap, Globe, AlertCircle } from 'lucide-react';
import { signIn, signUp, type AuthState } from '@/lib/auth/actions';

const ROLES = [
  { label: 'Member', href: '/dashboard', icon: Users },
  { label: 'Gym admin', href: '/admin', icon: Shield },
  { label: 'Instructor', href: '/coach', icon: GraduationCap },
  { label: 'Platform', href: '/superadmin', icon: Globe },
] as const;

const initial: AuthState = { error: null };

// revamp/login.html: brand-split layout, Sign in / Create gym tabs, email +
// password, role quick-access. Wired to the signIn / signUp server actions.
export function LoginClient({ initialMode = 'in' }: { initialMode?: 'in' | 'up' }) {
  const [mode, setMode] = useState<'in' | 'up'>(initialMode);
  const up = mode === 'up';
  const [inState, inAction, inPending] = useActionState(signIn, initial);
  const [upState, upAction, upPending] = useActionState(signUp, initial);
  const state = up ? upState : inState;
  const pending = up ? upPending : inPending;

  return (
    <>
      <aside className="brandside">
        <div className="brandside-bg" aria-hidden />
        <Link className="brand" href="/">
          <Image src="/images/logomark-v2.svg" alt="" width={38} height={38} className="mark-md" priority />
          <span className="brand-tx lg">Gym<em>Flow</em></span>
        </Link>
        <div className="bs-quote">
          <div className="stars" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => <Star key={i} strokeWidth={1.5} fill="currentColor" />)}
          </div>
          <p>&ldquo;Setup took an afternoon. Members add it to their home screen and it feels like our own app.&rdquo;</p>
          <div className="by">
            <span className="gf-avatar gf-avatar-md">K</span>
            <span><strong>Kelechi Obi</strong><small>IronWorks Gym, Port Harcourt</small></span>
          </div>
          <dl className="bs-stats">
            <div><dt>Active gyms</dt><dd>1,200+</dd></div>
            <div><dt>Check-ins / mo</dt><dd>480K</dd></div>
            <div><dt>Uptime</dt><dd>99.9%</dd></div>
          </dl>
        </div>
      </aside>

      <main className="formside">
        <div className="formcard">
          <Link className="brand" href="/" style={{ display: 'inline-flex' }}>
            <Image src="/images/logomark-v2.svg" alt="" width={30} height={30} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>
          <h1>{up ? 'Launch your gym' : 'Welcome back'}</h1>
          <p className="lede">{up ? 'Create your gym in one step — branded subdomain included.' : "Sign in to your gym's dashboard."}</p>

          <div className="tabs" role="tablist">
            <button className={!up ? 'on' : undefined} onClick={() => setMode('in')} role="tab" aria-selected={!up} type="button">Sign in</button>
            <button className={up ? 'on' : undefined} onClick={() => setMode('up')} role="tab" aria-selected={up} type="button">Create gym</button>
          </div>

          <form action={up ? upAction : inAction}>
            {up && (
              <div className="field gf-form-group">
                <label className="gf-form-label">Gym name</label>
                <input className="gf-input" name="gym" placeholder="e.g. Powerhouse Fitness" required />
              </div>
            )}
            <div className="field gf-form-group">
              <label className="gf-form-label">Email</label>
              <div className="gf-input-group">
                <Mail className="gf-input-icon" strokeWidth={1.75} />
                <input className="gf-input" type="email" name="email" placeholder="you@yourgym.ng" required />
              </div>
            </div>
            <div className="field gf-form-group">
              <label className="gf-form-label">Password</label>
              <div className="gf-input-group">
                <Lock className="gf-input-icon" strokeWidth={1.75} />
                <input className="gf-input" type="password" name="password" placeholder="••••••••" required />
              </div>
            </div>
            {!up && (
              <div className="row">
                <label><input type="checkbox" defaultChecked style={{ accentColor: 'var(--gf-brand)' }} /> Remember me</label>
                <Link href="/forgot-password">Forgot password?</Link>
              </div>
            )}
            {state.error && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: up ? '0 0 14px' : '-8px 0 14px' }}>
                <AlertCircle size={15} strokeWidth={2} /> {state.error}
              </p>
            )}
            <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={pending} style={{ marginTop: up ? 4 : 0 }}>
              {pending ? 'Please wait…' : up ? 'Launch your gym' : 'Sign in'} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
            </button>
          </form>

          <div className="divider">or jump in as</div>
          <div className="roles">
            {ROLES.map(({ label, href, icon: Icon }) => (
              <Link key={label} href={href} className="role-btn">
                <Icon strokeWidth={1.75} /> {label}
              </Link>
            ))}
          </div>

          <p className="foot-note">
            {up ? (
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

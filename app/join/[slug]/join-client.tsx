'use client';

import { useActionState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Mail, Lock, User, Phone, ArrowRight, AlertCircle, Dumbbell } from 'lucide-react';
import { joinAsNew, joinAsCurrent, type JoinState } from '@/lib/actions/join';

const initial: JoinState = { error: null };

// Gym invite landing — create a member account (or join with the signed-in
// one) linked to this gym.
export function JoinClient({ slug, gymName, logoUrl, currentEmail }: { slug: string; gymName: string; logoUrl: string | null; currentEmail: string | null }) {
  const [newState, newAction, newPending] = useActionState(joinAsNew, initial);
  const [curState, curAction, curPending] = useActionState(joinAsCurrent, initial);

  return (
    <div className="auth-shell" style={{ gridTemplateColumns: '1fr' }}>
      <main id="main-content" className="formside">
        <div className="formcard">
          <span className="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {logoUrl ? (
              <Image src={logoUrl} alt="" width={34} height={34} style={{ borderRadius: 9, objectFit: 'cover' }} />
            ) : (
              <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Dumbbell size={17} strokeWidth={1.9} /></span>
            )}
            <span className="brand-tx">{gymName}</span>
          </span>
          <h1>Join {gymName}</h1>
          <p className="lede">Create your member account — check in, book classes and renew from your phone.</p>

          {currentEmail ? (
            <form action={curAction}>
              <input type="hidden" name="slug" value={slug} />
              <p style={{ fontSize: '0.9rem', margin: '0 0 14px' }}>You&apos;re signed in as <strong>{currentEmail}</strong>.</p>
              {curState.error && (
                <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '0 0 14px' }}>
                  <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0 }} /> {curState.error}
                </p>
              )}
              <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={curPending}>
                {curPending ? 'Joining…' : `Join ${gymName}`} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
              </button>
            </form>
          ) : (
            <form action={newAction}>
              <input type="hidden" name="slug" value={slug} />
              <div className="field gf-form-group">
                <label className="gf-form-label">Your name</label>
                <div className="gf-input-group">
                  <User className="gf-input-icon" strokeWidth={1.75} />
                  <input className="gf-input" name="full_name" placeholder="Tunde Adeyemi" required />
                </div>
              </div>
              <div className="field gf-form-group">
                <label className="gf-form-label">Phone number</label>
                <div className="gf-input-group">
                  <Phone className="gf-input-icon" strokeWidth={1.75} />
                  <input className="gf-input" type="tel" name="phone" placeholder="080 1234 5678" inputMode="tel" autoComplete="tel" required />
                </div>
              </div>
              <div className="field gf-form-group">
                <label className="gf-form-label">Email</label>
                <div className="gf-input-group">
                  <Mail className="gf-input-icon" strokeWidth={1.75} />
                  <input className="gf-input" type="email" name="email" placeholder="you@example.com" required />
                </div>
              </div>
              <div className="field gf-form-group">
                <label className="gf-form-label">Password</label>
                <div className="gf-input-group">
                  <Lock className="gf-input-icon" strokeWidth={1.75} />
                  <input className="gf-input" type="password" name="password" placeholder="••••••••" required minLength={8} />
                </div>
              </div>
              {newState.error && (
                <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '0 0 14px' }}>
                  <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0 }} /> {newState.error}
                </p>
              )}
              <button className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full" type="submit" disabled={newPending}>
                {newPending ? 'Creating your account…' : 'Create account & join'} <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
              </button>
            </form>
          )}

          <p className="foot-note" style={{ marginTop: 16 }}>
            {currentEmail
              ? <Link href="/launch">Not now — take me to my dashboard</Link>
              : <>Already have an account? <Link href="/login">Sign in</Link>, then open this link again.</>}
          </p>
        </div>
      </main>
    </div>
  );
}

'use client';

import { useRef, useState, useActionState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { updateOwnProfile, type SaveState } from '@/lib/actions/profile';
import { uploadAvatar } from '@/lib/actions/instructor';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TOGS = [
  ['New booking alerts', 'When a member books your class', true],
  ['Cancellations', 'When someone cancels', true],
  ['Payout confirmations', 'When a payout lands', true],
  ['Weekly summary', 'Monday morning recap', false],
] as const;

const initial: SaveState = { ok: false, error: null };

export function CoachSettingsClient({ profile }: { profile: { full_name: string; specialisation: string; bio: string; initial: string; avatar_url: string | null } }) {
  const [avail, setAvail] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  const [togs, setTogs] = useState(TOGS.map((t) => t[2]));
  const [state, action, pending] = useActionState(updateOwnProfile, initial);
  const [avState, avAction, avPending] = useActionState(uploadAvatar, initial);
  const fileRef = useRef<HTMLInputElement>(null);
  const avFormRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <div className="hdr"><h1>Settings</h1><p>Manage your coach profile and availability</p></div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Profile</h3></div></div>
          <form action={avAction} ref={avFormRef}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote Supabase URL, fixed avatar size
                <img src={profile.avatar_url} alt="" className="gf-avatar gf-avatar-xl" style={{ objectFit: 'cover', borderColor: 'var(--gf-brand-glow)' }} />
              ) : (
                <span className="gf-avatar gf-avatar-xl" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>{profile.initial}</span>
              )}
              <input ref={fileRef} type="file" name="avatar" accept="image/*" hidden onChange={() => avFormRef.current?.requestSubmit()} />
              <button type="button" className="gf-btn gf-btn-secondary gf-btn-sm" disabled={avPending} onClick={() => fileRef.current?.click()}>{avPending ? 'Uploading…' : 'Change photo'}</button>
              {avState.error && <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gf-danger)', fontSize: '0.82rem' }}><AlertCircle size={14} strokeWidth={2} /> {avState.error}</span>}
            </div>
          </form>
          <form action={action}>
            <div className="gf-form-group"><label className="gf-form-label">Display name</label><input className="gf-input" name="full_name" defaultValue={profile.full_name} /></div>
            <div className="gf-form-group"><label className="gf-form-label">Specialties</label><input className="gf-input" name="specialisation" defaultValue={profile.specialisation} /></div>
            <div className="gf-form-group" style={{ marginBottom: 16 }}><label className="gf-form-label">Bio</label><textarea className="gf-textarea" name="bio" rows={3} defaultValue={profile.bio} /></div>
            {state.error && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '0 0 12px' }}><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
            {state.ok && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-brand)', fontSize: '0.84rem', margin: '0 0 12px' }}><Check size={15} strokeWidth={2.4} /> Saved.</p>}
            <button className="gf-btn gf-btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
          </form>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Availability</h3><div className="sub">Days you&apos;re open to teach</div></div></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => setAvail((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} className={`gf-chip${avail.has(i) ? ' active' : ''}`} style={{ cursor: 'pointer' }}>{d}</button>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>Notifications</h3></div></div>
            {TOGS.map((t, i) => (
              <div className="tog" key={t[0]}>
                <div className="m"><strong>{t[0]}</strong><small>{t[1]}</small></div>
                <button className={`sw${togs[i] ? ' on' : ''}`} aria-pressed={togs[i]} onClick={() => setTogs((p) => p.map((v, j) => j === i ? !v : v))} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

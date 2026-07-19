'use client';

import { useRef, useState, useActionState } from 'react';
import Image from 'next/image';
import { Check, AlertCircle } from 'lucide-react';
import { updateOwnProfile, type SaveState } from '@/lib/actions/profile';
import { uploadAvatar, savePrefs } from '@/lib/actions/instructor';

// UI order Mon..Sun → stored as JS getDay() ints (0=Sun..6=Sat), matching
// class_schedules.day_of_week across the app.
const DAYS: Array<[label: string, dow: number]> = [
  ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0],
];

const initial: SaveState = { ok: false, error: null };

export type CoachProfile = {
  full_name: string; specialisation: string; bio: string; initial: string; avatar_url: string | null;
  notification_email: boolean; notification_whatsapp: boolean; availability: number[];
};

export function CoachSettingsClient({ profile }: { profile: CoachProfile }) {
  const [avail, setAvail] = useState<Set<number>>(new Set(profile.availability));
  const [state, action, pending] = useActionState(updateOwnProfile, initial);
  const [avState, avAction, avPending] = useActionState(uploadAvatar, initial);
  const [prefState, prefAction, prefPending] = useActionState(savePrefs, initial);
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
                // .gf-avatar-xl is a fixed 72×72 box.
                <Image src={profile.avatar_url} alt="" className="gf-avatar gf-avatar-xl" width={72} height={72} style={{ objectFit: 'cover', borderColor: 'var(--gf-brand-glow)' }} />
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

        {/* Availability + notification channels persist to the profile row. */}
        <form action={prefAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Availability</h3><div className="sub">Days you&apos;re open to teach</div></div></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map(([label, dow]) => (
                <button key={dow} type="button" onClick={() => setAvail((s) => { const n = new Set(s); if (n.has(dow)) n.delete(dow); else n.add(dow); return n; })} className={`gf-chip${avail.has(dow) ? ' active' : ''}`} style={{ cursor: 'pointer' }}>{label}</button>
              ))}
            </div>
            {[...avail].map((d) => <input key={d} type="hidden" name="day" value={d} />)}
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>Notifications</h3><div className="sub">How we reach you about bookings &amp; payouts</div></div></div>
            <label className="tog" style={{ cursor: 'pointer' }}>
              <div className="m"><strong>Email</strong><small>Booking alerts, cancellations, payout confirmations</small></div>
              <input type="checkbox" name="notification_email" defaultChecked={profile.notification_email} style={{ accentColor: 'var(--gf-brand)', width: 18, height: 18 }} />
            </label>
            <label className="tog" style={{ cursor: 'pointer' }}>
              <div className="m"><strong>WhatsApp</strong><small>Same alerts on WhatsApp</small></div>
              <input type="checkbox" name="notification_whatsapp" defaultChecked={profile.notification_whatsapp} style={{ accentColor: 'var(--gf-brand)', width: 18, height: 18 }} />
            </label>
            {prefState.error && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '10px 0 0' }}><AlertCircle size={15} strokeWidth={2} /> {prefState.error}</p>}
            {prefState.ok && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-brand)', fontSize: '0.84rem', margin: '10px 0 0' }}><Check size={15} strokeWidth={2.4} /> Saved.</p>}
            <button className="gf-btn gf-btn-primary gf-btn-sm" type="submit" disabled={prefPending} style={{ marginTop: 12 }}>{prefPending ? 'Saving…' : 'Save preferences'}</button>
          </div>
        </form>
      </div>
    </>
  );
}

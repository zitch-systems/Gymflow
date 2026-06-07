'use client';
import { useState } from 'react';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TOGS = [
  ['New booking alerts', 'When a member books your class', true],
  ['Cancellations', 'When someone cancels', true],
  ['Payout confirmations', 'When a payout lands', true],
  ['Weekly summary', 'Monday morning recap', false],
] as const;
export default function CoachSettings() {
  const [avail, setAvail] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  const [togs, setTogs] = useState(TOGS.map((t) => t[2]));
  return (
    <>
      <div className="hdr"><h1>Settings</h1><p>Manage your coach profile and availability</p></div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Profile</h3></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <span className="gf-avatar gf-avatar-xl" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>F</span>
            <button className="gf-btn gf-btn-secondary gf-btn-sm">Change photo</button>
          </div>
          <div className="gf-form-group"><label className="gf-form-label">Display name</label><input className="gf-input" defaultValue="Coach Femi Adewale" /></div>
          <div className="gf-form-group"><label className="gf-form-label">Specialties</label><input className="gf-input" defaultValue="Strength · HIIT · Powerlifting" /></div>
          <div className="gf-form-group" style={{ marginBottom: 16 }}><label className="gf-form-label">Bio</label><textarea className="gf-textarea" rows={3} defaultValue="NSCA-certified strength coach. 8 years training athletes and everyday lifters." /></div>
          <button className="gf-btn gf-btn-primary">Save profile</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Availability</h3><div className="sub">Days you&apos;re open to teach</div></div></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => setAvail((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                  className={`gf-chip${avail.has(i) ? ' active' : ''}`} style={{ cursor: 'pointer' }}>{d}</button>
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

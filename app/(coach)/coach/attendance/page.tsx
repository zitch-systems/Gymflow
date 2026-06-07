'use client';
import { useState } from 'react';
import { CheckCheck, Check } from 'lucide-react';
const ROSTER = [
  { i: 'TA', name: 'Tunde Adeyemi' }, { i: 'GU', name: 'Grace Udeh' }, { i: 'MA', name: 'Musa Abdul' },
  { i: 'BA', name: 'Bola Ade' }, { i: 'CO', name: 'Chidi Okeke' }, { i: 'TI', name: 'Tina Idris' },
];
export default function CoachAttendance() {
  const [inSet, setInSet] = useState<Set<number>>(new Set([0, 1, 2, 4]));
  const toggle = (i: number) => setInSet((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  return (
    <>
      <div className="hdr"><h1>Attendance</h1><p>Thursday, 30 May · mark who showed up</p></div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Power Lifting · 09:00</h3><div className="sub">{inSet.size} checked in · {ROSTER.length - inSet.size} pending</div></div>
            <button className="gf-btn gf-btn-sm gf-btn-primary" onClick={() => setInSet(new Set(ROSTER.map((_, i) => i)))}><CheckCheck strokeWidth={1.9} size={15} /> Mark all in</button>
          </div>
          {ROSTER.map((r, i) => (
            <div className="ar" key={r.name}>
              <span className="gf-avatar gf-avatar-sm">{r.i}</span>
              <div className="m" style={{ flex: 1, minWidth: 0 }}><strong style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.88rem' }}>{r.name}</strong></div>
              <button className={`gf-btn gf-btn-sm ${inSet.has(i) ? 'gf-btn-primary' : 'gf-btn-secondary'}`} onClick={() => toggle(i)}>
                {inSet.has(i) ? <><Check strokeWidth={2.2} size={14} /> In</> : 'Mark in'}
              </button>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Today&apos;s classes</h3></div></div>
          <div className="cls-pick">
            {['06:30 Sunrise HIIT', '09:00 Power Lifting', '17:30 Conditioning'].map((c, i) => (
              <div key={c} className={`cl${i === 1 ? ' on' : ''}`} style={{ padding: '12px 14px', border: '1px solid var(--gf-border)', borderRadius: 'var(--gf-radius-sm)', marginBottom: 8, fontFamily: 'var(--gf-font-display)', fontWeight: 600, fontSize: '0.88rem', background: i === 1 ? 'var(--gf-brand-soft)' : 'var(--gf-surface)', borderColor: i === 1 ? 'var(--gf-brand)' : 'var(--gf-border)' }}>{c}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

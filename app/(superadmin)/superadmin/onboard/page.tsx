import { UserPlus, Check } from 'lucide-react';
export const metadata = { title: 'Onboard a gym' };
const STEPS = ['Gym details', 'Owner account', 'Plan & billing', 'Go live'];
export default function SuperOnboard() {
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Onboard a gym</h1><p>Provision a new tenant with a branded subdomain in minutes</p></div></div>
      <div className="two" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-title">Gym details</div>
          <div className="panel-desc">The basics — we provision the subdomain instantly.</div>
          <div className="frow"><div className="gf-form-group"><label className="gf-form-label">Gym name</label><input className="gf-input" placeholder="e.g. Summit Fitness" /></div><div className="gf-form-group"><label className="gf-form-label">Subdomain</label><input className="gf-input" placeholder="summit" /></div></div>
          <div className="frow"><div className="gf-form-group"><label className="gf-form-label">City</label><input className="gf-input" placeholder="Lagos" /></div><div className="gf-form-group"><label className="gf-form-label">Plan</label><select className="gf-select"><option>Starter — ₦13,999/mo</option><option>Growth — ₦37,999/mo</option><option>Scale — ₦119,999/mo</option></select></div></div>
          <div className="frow"><div className="gf-form-group"><label className="gf-form-label">Owner name</label><input className="gf-input" placeholder="Owner full name" /></div><div className="gf-form-group"><label className="gf-form-label">Owner email</label><input className="gf-input" type="email" placeholder="owner@gym.ng" /></div></div>
          <button className="gf-btn gf-btn-primary" style={{ marginTop: 6 }}><UserPlus strokeWidth={1.9} size={16} /> Provision gym</button>
        </div>
        <div className="panel">
          <div className="panel-title">Setup steps</div>
          <div className="steps" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            {STEPS.map((s, i) => (
              <div className="step" key={s} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span className="sq" style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: i === 0 ? 'var(--gf-brand)' : 'var(--gf-elevated)', color: i === 0 ? '#fff' : 'var(--gf-text-muted)', fontFamily: 'var(--gf-font-display)', fontWeight: 800, fontSize: '0.8rem' }}>{i === 0 ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
                <span style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 600, fontSize: '0.88rem' }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

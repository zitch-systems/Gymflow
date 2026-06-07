import { Check } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { OnboardForm } from './onboard-form';

export const metadata = { title: 'Onboard a gym' };

const STEPS = ['Gym details', 'Owner account', 'Plan & billing', 'Go live'];

export default async function SuperOnboard() {
  await requirePlatformAdmin();
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Onboard a gym</h1><p>Provision a new tenant with a branded subdomain in minutes</p></div></div>
      <div className="two" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        <OnboardForm />
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

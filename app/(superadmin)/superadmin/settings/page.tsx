import { CreditCard, MessageCircle, Mail, BarChart3 } from 'lucide-react';
export const metadata = { title: 'Platform settings' };
const INTEG = [
  { icon: CreditCard, name: 'Paystack', sub: 'Platform-wide payment rails', st: ['gf-badge-success', 'Live'] },
  { icon: MessageCircle, name: 'Termii (WhatsApp/SMS)', sub: 'Reminder delivery', st: ['gf-badge-success', 'Live'] },
  { icon: Mail, name: 'Resend', sub: 'Transactional email', st: ['gf-badge-success', 'Live'] },
  { icon: BarChart3, name: 'PostHog', sub: 'Product analytics', st: ['gf-badge-neutral', 'Optional'] },
];
export default function SuperSettings() {
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Platform settings</h1><p>Global configuration for all tenants</p></div></div>
      <div className="two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-title">Platform defaults</div>
          <div className="panel-desc">Applied to every new gym at provision time.</div>
          <div className="frow"><div className="gf-form-group"><label className="gf-form-label">Platform commission</label><input className="gf-input" defaultValue="3%" /></div><div className="gf-form-group"><label className="gf-form-label">Trial length</label><input className="gf-input" defaultValue="14 days" /></div></div>
          <div className="gf-form-group" style={{ marginBottom: 16 }}><label className="gf-form-label">Default currency</label><input className="gf-input" defaultValue="₦ Naira (NGN)" /></div>
          <button className="gf-btn gf-btn-primary">Save defaults</button>
        </div>
        <div className="panel">
          <div className="panel-title">Integrations</div>
          <div className="panel-desc">Platform-level service connections.</div>
          {INTEG.map((it) => { const Icon = it.icon; return (
            <div className="integ" key={it.name}><div className="ig" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Icon strokeWidth={1.75} /></div><div className="m"><strong>{it.name}</strong><small>{it.sub}</small></div><span className={`gf-badge ${it.st[0]}`}><span className="gf-dot" />{it.st[1]}</span></div>
          ); })}
        </div>
      </div>
    </>
  );
}

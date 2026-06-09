import { CreditCard, MessageCircle, Mail, BarChart3, ShieldCheck } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Platform settings' };

const INTEG = [
  { icon: CreditCard, name: 'Paystack', sub: 'Platform-wide payment rails', env: 'PAYSTACK_SECRET_KEY' },
  { icon: MessageCircle, name: 'Termii (WhatsApp/SMS)', sub: 'Reminder delivery', env: 'TERMII_API_KEY' },
  { icon: Mail, name: 'Resend', sub: 'Transactional email', env: 'RESEND_API_KEY' },
  { icon: BarChart3, name: 'PostHog', sub: 'Product analytics', env: 'NEXT_PUBLIC_POSTHOG_KEY' },
];

export default async function SuperSettings() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: admins } = await supabase.from('platform_admins').select('name, email, is_active').eq('is_active', true);

  // Integration status reflects whether the env key is actually set.
  const status = (key: string) => (process.env[key] ? ['gf-badge-success', 'Live'] : ['gf-badge-neutral', 'Not set']);

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Platform settings</h1><p>Global configuration for all tenants</p></div></div>
      <div className="two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-title">Platform defaults</div>
            <div className="panel-desc">Applied to every new gym at provision time. Fixed platform-wide for now.</div>
            <div className="frow"><div className="gf-form-group"><label className="gf-form-label">Platform commission</label><input className="gf-input" value="3%" readOnly disabled /></div><div className="gf-form-group"><label className="gf-form-label">Trial length</label><input className="gf-input" value="14 days" readOnly disabled /></div></div>
            <div className="gf-form-group"><label className="gf-form-label">Default currency</label><input className="gf-input" value="₦ Naira (NGN)" readOnly disabled /></div>
          </div>
          <div className="panel">
            <div className="panel-title">Platform admins</div>
            <div className="panel-desc">{(admins ?? []).length} active</div>
            {(admins ?? []).map((a) => (
              <div className="integ" key={a.email}>
                <div className="ig" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}><ShieldCheck strokeWidth={1.75} /></div>
                <div className="m"><strong>{a.name}</strong><small>{a.email}</small></div>
                <span className="gf-badge gf-badge-success">Active</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">Integrations</div>
          <div className="panel-desc">Status reflects whether the server env key is configured.</div>
          {INTEG.map((it) => {
            const Icon = it.icon; const st = status(it.env);
            return (
              <div className="integ" key={it.name}><div className="ig" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Icon strokeWidth={1.75} /></div><div className="m"><strong>{it.name}</strong><small>{it.sub}</small></div><span className={`gf-badge ${st[0]}`}><span className="gf-dot" />{st[1]}</span></div>
            );
          })}
        </div>
      </div>
    </>
  );
}

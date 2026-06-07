import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { PLATFORM_PRICING, BILLING_PERIODS, formatNaira, periodSavings } from '@/lib/platform-pricing';
import { Database, CreditCard, Mail, MessageCircle, BarChart3, ShieldAlert, Bell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const isSet = (v: string | undefined | null) => typeof v === 'string' && v.trim().length > 0;

export default async function SuperadminSettingsPage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const integrations: { name: string; desc: string; icon: LucideIcon; on: boolean; tint: 'brand' | 'info' | 'lime' | 'amber' | 'rose' | 'slate' }[] = [
    { name: 'Supabase', desc: 'Database, auth & row-level security', icon: Database, tint: 'lime', on: isSet(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    { name: 'Paystack', desc: 'Payments & subscriptions', icon: CreditCard, tint: 'brand', on: isSet(process.env.PAYSTACK_SECRET_KEY) },
    { name: 'Resend', desc: 'Transactional email', icon: Mail, tint: 'info', on: isSet(process.env.RESEND_API_KEY) },
    { name: 'Termii', desc: 'WhatsApp & SMS reminders', icon: MessageCircle, tint: 'brand', on: isSet(process.env.TERMII_API_KEY) },
    { name: 'PostHog', desc: 'Product analytics', icon: BarChart3, tint: 'amber', on: isSet(process.env.NEXT_PUBLIC_POSTHOG_KEY) },
    { name: 'Sentry', desc: 'Error monitoring', icon: ShieldAlert, tint: 'rose', on: isSet(process.env.SENTRY_DSN) || isSet(process.env.NEXT_PUBLIC_SENTRY_DSN) },
    { name: 'Web Push', desc: 'Browser push notifications', icon: Bell, tint: 'slate', on: isSet(process.env.VAPID_PUBLIC_KEY) && isSet(process.env.VAPID_PRIVATE_KEY) },
  ];
  const connectedCount = integrations.filter((i) => i.on).length;

  const TINT: Record<typeof integrations[number]['tint'], { bg: string; fg: string }> = {
    brand: { bg: 'var(--gf-brand-soft)', fg: 'var(--gf-brand)' },
    info:  { bg: 'var(--gf-info-soft)', fg: 'var(--gf-info)' },
    lime:  { bg: 'rgba(198, 242, 78, 0.12)', fg: '#a8d92e' },
    amber: { bg: 'var(--gf-warning-soft)', fg: 'var(--gf-warning)' },
    rose:  { bg: 'var(--gf-danger-soft)', fg: 'var(--gf-danger)' },
    slate: { bg: 'var(--gf-elevated)', fg: 'var(--gf-text-secondary)' },
  };

  const general: { label: string; value: string }[] = [
    { label: 'Platform name', value: 'GymFlow' },
    { label: 'Default currency', value: 'NGN — Nigerian Naira (₦)' },
    { label: 'Support email', value: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || '—' },
    { label: 'Site URL', value: process.env.NEXT_PUBLIC_SITE_URL || '—' },
  ];

  const defaults: { label: string; value: string }[] = [
    { label: 'Default plan', value: `${PLATFORM_PRICING.monthly.label} · ${formatNaira(PLATFORM_PRICING.monthly.amount)}/mo` },
    { label: 'First billing', value: '1 month after onboarding' },
    { label: 'Initial status', value: 'Active' },
    { label: 'Branded subdomain', value: 'name.gymflow.ng' },
  ];

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Platform settings</h1>
          <p>Global configuration across all tenants · read-only overview</p>
        </div>
      </div>

      <section className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>General</h3>
                <div className="sub">Platform metadata</div>
              </div>
            </div>
            <div>
              {general.map((g) => (
                <div key={g.label} className="set-row">
                  <div className="m">
                    <strong>{g.label}</strong>
                    <small>&nbsp;</small>
                  </div>
                  <span style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 600, fontSize: '0.88rem', color: 'var(--gf-text)', textAlign: 'right', wordBreak: 'break-word' }}>{g.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Defaults for new gyms</h3>
                <div className="sub">Applied at onboarding</div>
              </div>
            </div>
            <div>
              {defaults.map((d) => (
                <div key={d.label} className="set-row">
                  <div className="m">
                    <strong>{d.label}</strong>
                    <small>&nbsp;</small>
                  </div>
                  <span style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 600, fontSize: '0.88rem', color: 'var(--gf-text)', textAlign: 'right' }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <div>
            <h3>Integrations</h3>
            <div className="sub">{connectedCount} of {integrations.length} connected</div>
          </div>
        </div>
        <div>
          {integrations.map((i) => {
            const Icon = i.icon;
            const tint = TINT[i.tint];
            return (
              <div key={i.name} className="integ">
                <div className="ig" style={{ background: tint.bg, color: tint.fg }} aria-hidden>
                  <Icon size={20} strokeWidth={1.75} />
                </div>
                <div className="m">
                  <strong>{i.name}</strong>
                  <small>{i.desc}</small>
                </div>
                <span className={`gf-badge ${i.on ? 'gf-badge-success' : 'gf-badge-neutral'}`}>
                  <span className="gf-dot" />
                  {i.on ? 'Connected' : 'Not configured'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <div>
            <h3>Platform plans</h3>
            <div className="sub">What a gym pays GymFlow</div>
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Duration</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th style={{ textAlign: 'right' }}>Savings</th>
            </tr>
          </thead>
          <tbody>
            {BILLING_PERIODS.map((p) => {
              const cfg = PLATFORM_PRICING[p];
              const save = periodSavings(p);
              return (
                <tr key={p}>
                  <td><strong>{cfg.label}</strong></td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{cfg.months} month{cfg.months === 1 ? '' : 's'}</td>
                  <td className="naira" style={{ textAlign: 'right' }}>
                    {formatNaira(cfg.amount)}<span style={{ color: 'var(--gf-text-muted)', fontWeight: 500 }}>/{cfg.per}</span>
                  </td>
                  <td style={{ textAlign: 'right', color: save > 0 ? 'var(--gf-success)' : 'var(--gf-text-muted)' }}>
                    {save > 0 ? `−${formatNaira(save)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

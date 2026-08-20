import Link from 'next/link';
import { CreditCard, MessageCircle, Mail, BarChart3, ShieldCheck, Bot, KeyRound } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPlatformSettings } from '@/lib/platform-settings';
import { secretsConfigured } from '@/lib/crypto/secret-box';
import { arrangementLabel, isDefaultArrangement } from '@/lib/commission-breakdown';
import { sa } from '@/lib/superadmin-path';
import { PlatformDefaultsForm } from './defaults-form';

export const metadata = { title: 'Platform settings' };

const INTEG = [
  { icon: CreditCard, name: 'Paystack', sub: 'Platform-wide payment rails', env: 'PAYSTACK_SECRET_KEY' },
  { icon: MessageCircle, name: 'Termii (WhatsApp/SMS)', sub: 'Reminder delivery', env: 'TERMII_API_KEY' },
  { icon: Mail, name: 'Resend', sub: 'Transactional email', env: 'RESEND_API_KEY' },
  { icon: BarChart3, name: 'PostHog', sub: 'Product analytics', env: 'NEXT_PUBLIC_POSTHOG_KEY' },
];

export default async function SuperSettings() {
  await requirePlatformAdmin();
  // Read the full roster via the service-role client: the platform_admins
  // SELECT policy (pa_select_self) only returns the caller's own row, so the
  // RLS-scoped client would show "1 active" no matter how many admins exist.
  // Safe here because the page is already gated by requirePlatformAdmin().
  const supabase = createAdminClient();
  const [{ data: admins }, defaults, { data: gymRates }] = await Promise.all([
    supabase.from('platform_admins').select('name, email, is_active').eq('is_active', true),
    getPlatformSettings(supabase),
    // What every live gym is ACTUALLY on. The default above only decides what a
    // new gym starts at, and the two drifting apart silently is exactly how the
    // console ended up claiming a rate nobody was charged.
    // Mode and flat amount too: a gym on a flat deal keeps a percentage on its
    // row as Paystack's fallback, so reading the percentage alone reports an
    // arrangement it is not on — and calls it "the default" while it is on a
    // negotiated one.
    supabase.from('gyms').select('id, name, platform_commission_pct, platform_commission_mode, platform_commission_fixed_amount, status')
      .not('status', 'in', '("terminated")')
      .order('name', { ascending: true }),
  ]);

  // Integration status reflects whether the env key is actually set.
  const status = (key: string) => (process.env[key] ? ['gf-badge-success', 'Live'] : ['gf-badge-neutral', 'Not set']);

  const rates = (gymRates ?? []) as {
    id: string; name: string; status: string | null;
    platform_commission_pct: number | null;
    platform_commission_mode: string | null;
    platform_commission_fixed_amount: number | null;
  }[];
  const arrangementOf = (g: (typeof rates)[number]) => ({
    mode: g.platform_commission_mode, pct: g.platform_commission_pct, fixed: g.platform_commission_fixed_amount,
  });
  const offDefault = rates.filter((g) => !isDefaultArrangement(arrangementOf(g), defaults.defaultCommissionPct));

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Platform settings</h1><p>Global configuration for all tenants</p></div></div>
      <div className="two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PlatformDefaultsForm commissionPct={defaults.defaultCommissionPct} trialDays={defaults.defaultTrialDays} />

          <div className="panel">
            <div className="panel-title">Commission in force</div>
            <div className="panel-desc">
              {rates.length} gym{rates.length === 1 ? '' : 's'} · {offDefault.length} on an arrangement other than the {defaults.defaultCommissionPct}% default.
              Change one from its page under Gyms.
            </div>
            {rates.length === 0 && <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>No gyms yet.</div>}
            {rates.map((g) => (
              <div className="integ" key={g.id}>
                <div className="m">
                  <strong><Link href={sa(`/gyms/${g.id}`)} style={{ color: 'inherit' }}>{g.name}</Link></strong>
                  <small>{g.status ?? 'unknown'}</small>
                </div>
                <span className={`gf-badge ${isDefaultArrangement(arrangementOf(g), defaults.defaultCommissionPct) ? 'gf-badge-neutral' : 'gf-badge-warning'}`}>
                  {arrangementLabel(arrangementOf(g))}
                </span>
              </div>
            ))}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-title">Integrations</div>
            <div className="panel-desc">Status reflects whether the server env key is configured.</div>
            {INTEG.map((it) => {
              const Icon = it.icon; const st = status(it.env);
              return (
                <div className="integ" key={it.name}><div className="ig" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Icon strokeWidth={1.75} /></div><div className="m"><strong>{it.name}</strong><small>{it.sub}</small></div><span className={`gf-badge ${st[0]}`}><span className="gf-dot" />{st[1]}</span></div>
              );
            })}
            <div className="integ">
              <div className="ig" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><KeyRound strokeWidth={1.75} /></div>
              <div className="m"><strong>Secrets encryption</strong><small>Encrypts stored provider keys at rest</small></div>
              <span className={`gf-badge ${secretsConfigured() ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{secretsConfigured() ? 'Live' : 'Not set'}</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Backends</div>
            <div className="panel-desc">The two platform services gyms switch on for themselves.</div>
            <div className="integ">
              <div className="ig" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}><Bot strokeWidth={1.75} /></div>
              <div className="m"><strong><Link href={sa('/ai')} style={{ color: 'inherit' }}>AI providers</Link></strong><small>Model vendors, platform keys, which gyms may pick them</small></div>
            </div>
            <div className="integ">
              <div className="ig" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)' }}><MessageCircle strokeWidth={1.75} /></div>
              <div className="m"><strong><Link href={sa('/whatsapp')} style={{ color: 'inherit' }}>WhatsApp channel</Link></strong><small>Shared business number, per-gym rollout</small></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

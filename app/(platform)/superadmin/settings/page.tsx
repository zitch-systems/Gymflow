import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { PLATFORM_PRICING, BILLING_PERIODS, formatNaira, periodSavings } from '@/lib/platform-pricing';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { ArrowLeft, Database, CreditCard, Mail, MessageCircle, BarChart3, ShieldAlert, Bell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Read-only overview. Every value here is the platform's REAL configuration —
// integration status is derived from whether each secret is actually set, and
// defaults/pricing come from the same constants the onboarding flow uses. No
// values are persisted from this page yet (no settings store exists), so the
// editable toggles from the prototype are intentionally shown as read state.
const isSet = (v: string | undefined | null) => typeof v === 'string' && v.trim().length > 0;

export default async function SuperadminSettingsPage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const integrations: { name: string; desc: string; icon: LucideIcon; on: boolean }[] = [
    { name: 'Supabase', desc: 'Database, auth & row-level security', icon: Database, on: isSet(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    { name: 'Paystack', desc: 'Payments & subscriptions', icon: CreditCard, on: isSet(process.env.PAYSTACK_SECRET_KEY) },
    { name: 'Resend', desc: 'Transactional email', icon: Mail, on: isSet(process.env.RESEND_API_KEY) },
    { name: 'Termii', desc: 'WhatsApp & SMS reminders', icon: MessageCircle, on: isSet(process.env.TERMII_API_KEY) },
    { name: 'PostHog', desc: 'Product analytics', icon: BarChart3, on: isSet(process.env.NEXT_PUBLIC_POSTHOG_KEY) },
    { name: 'Sentry', desc: 'Error monitoring', icon: ShieldAlert, on: isSet(process.env.SENTRY_DSN) || isSet(process.env.NEXT_PUBLIC_SENTRY_DSN) },
    { name: 'Web Push', desc: 'Browser push notifications', icon: Bell, on: isSet(process.env.VAPID_PUBLIC_KEY) && isSet(process.env.VAPID_PRIVATE_KEY) },
  ];
  const connectedCount = integrations.filter((i) => i.on).length;

  const general: { label: string; value: string }[] = [
    { label: 'Platform name', value: 'GymFlow' },
    { label: 'Default currency', value: 'NGN — Nigerian Naira (₦)' },
    { label: 'Support email', value: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || '—' },
    { label: 'Site URL', value: process.env.NEXT_PUBLIC_SITE_URL || '—' },
  ];

  // Mirrors the gym-onboarding insert in lib/actions/platform.ts.
  const defaults: { label: string; value: string }[] = [
    { label: 'Default plan', value: `${PLATFORM_PRICING.monthly.label} · ${formatNaira(PLATFORM_PRICING.monthly.amount)}/mo` },
    { label: 'First billing', value: '1 month after onboarding' },
    { label: 'Initial status', value: 'Active' },
    { label: 'Branded subdomain', value: 'name.gymflow.ng' },
  ];

  return (
    <div className="gf-page">
      <PageHeader
        title="Platform settings"
        subtitle="Global configuration across all tenants · read-only overview"
        actions={
          <ButtonLink href="/superadmin" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back
          </ButtonLink>
        }
      />

      <div className="adm-dash-row">
        <Card>
          <CardHeader title="General" />
          <ul className="gf-list">
            {general.map((g) => (
              <li key={g.label} className="gf-list-row">
                <span className="gf-table-meta">{g.label}</span>
                <span style={{ fontWeight: 600, textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>{g.value}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Defaults for new gyms" />
          <ul className="gf-list">
            {defaults.map((d) => (
              <li key={d.label} className="gf-list-row">
                <span className="gf-table-meta">{d.label}</span>
                <span style={{ fontWeight: 600, textAlign: 'right' }}>{d.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Integrations" subtitle={`${connectedCount} of ${integrations.length} connected`} />
        <ul className="gf-list">
          {integrations.map((i) => {
            const Icon = i.icon;
            return (
              <li key={i.name} className="gf-list-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span
                    aria-hidden
                    style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)', flexShrink: 0 }}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block' }}>{i.name}</strong>
                    <span className="gf-table-meta">{i.desc}</span>
                  </span>
                </span>
                <Badge tone={i.on ? 'on' : 'neutral'}>{i.on ? 'Connected' : 'Not configured'}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Platform plans" subtitle="What a gym pays GymFlow" />
        <ul className="gf-list">
          {BILLING_PERIODS.map((p) => {
            const cfg = PLATFORM_PRICING[p];
            const save = periodSavings(p);
            return (
              <li key={p} className="gf-list-row">
                <span>
                  <strong>{cfg.label}</strong>
                  <span className="gf-table-meta"> · {cfg.months} month{cfg.months === 1 ? '' : 's'}</span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <strong style={{ fontFamily: 'var(--gf-font-display)' }}>{formatNaira(cfg.amount)}</strong>
                  <span className="gf-table-meta">/{cfg.per}</span>
                  {save > 0 && <span className="gf-table-meta"> · save {formatNaira(save)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

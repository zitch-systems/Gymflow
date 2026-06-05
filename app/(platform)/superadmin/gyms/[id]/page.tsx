import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { daysAgoIso } from '@/lib/dates';
import { Stat } from '@/components/ui/stat';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SuperadminGymRowActions } from '../../gym-row-actions';
import { ArrowLeft, Users, UserCheck, Banknote, Wallet, Receipt } from 'lucide-react';

const GRADS = [
  'linear-gradient(135deg, #11d18b, #07a86c)',
  'linear-gradient(135deg, #4080ff, #2a5cc0)',
  'linear-gradient(135deg, #a8d92e, #6a9c00)',
  'linear-gradient(135deg, #ffb020, #cc8a10)',
  'linear-gradient(135deg, #b67bf3, #7c45c0)',
  'linear-gradient(135deg, #ff4560, #cc2a40)',
];
const gradFor = (s: string) => GRADS[s.charCodeAt(0) % GRADS.length];

// gyms.subscription_status ∈ trial|active|past_due|cancelled (lib/actions/platform.ts).
const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'gf-badge-success' },
  trial: { label: 'Trial', cls: 'gf-badge-warning' },
  past_due: { label: 'Past due', cls: 'gf-badge-danger' },
  cancelled: { label: 'Cancelled', cls: 'gf-badge-neutral' },
};
const SETTLE_LABEL: Record<string, string> = {
  successful: 'Settled',
  failed: 'Failed',
  pending: 'Pending',
  refunded: 'Refunded',
};

type PageProps = { params: Promise<{ id: string }> };

export default async function SuperadminGymDetailPage({ params }: PageProps) {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const { id } = await params;
  const admin = await createClient();
  const since30 = daysAgoIso(30);

  const [{ data: gym }, { count: memberCount }, { count: activeCount }, { data: payments }] = await Promise.all([
    admin
      .from('gyms')
      .select('id, name, slug, subscription_plan, subscription_status, city, state, email, phone, created_at, trial_ends_at, max_members')
      .eq('id', id)
      .maybeSingle(),
    admin.from('gym_member_links').select('*', { count: 'exact', head: true }).eq('gym_id', id),
    admin
      .from('gym_member_links')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', id)
      .eq('is_active', true)
      .eq('status', 'active'),
    admin
      .from('platform_payments')
      .select('amount, created_at, payment_status, plan')
      .eq('gym_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (!gym) notFound();

  const ms30 = Date.parse(since30);
  let mrr30 = 0;
  let lifetime = 0;
  for (const p of payments ?? []) {
    if (p.payment_status !== 'successful') continue;
    const amt = Number(p.amount ?? 0);
    lifetime += amt;
    if (p.created_at && Date.parse(p.created_at) >= ms30) mrr30 += amt;
  }
  const recent = (payments ?? []).slice(0, 10);

  const meta = STATUS_META[gym.subscription_status ?? ''] ?? { label: gym.subscription_status ?? '—', cls: 'gf-badge-neutral' };
  const place = [gym.city, gym.state].filter(Boolean).join(', ') || '—';

  const details: { label: string; value: ReactNode }[] = [
    { label: 'Plan', value: <span style={{ textTransform: 'capitalize' }}>{gym.subscription_plan ?? '—'}</span> },
    {
      label: 'Status',
      value: (
        <span className={`gf-badge ${meta.cls}`}>
          <span className="gf-dot" />
          {meta.label}
        </span>
      ),
    },
    { label: 'Subdomain', value: `${gym.slug}.gymflow.ng` },
    { label: 'Location', value: place },
    { label: 'Owner email', value: gym.email ?? '—' },
    { label: 'Owner phone', value: gym.phone ?? '—' },
    { label: 'Joined', value: fmtDate(gym.created_at) },
    { label: 'Next billing', value: gym.trial_ends_at ? fmtDate(gym.trial_ends_at) : '—' },
    { label: 'Capacity', value: gym.max_members != null ? `${gym.max_members} members` : '—' },
  ];

  return (
    <div className="gf-page">
      <div className="page-h">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            aria-hidden
            style={{
              width: 48, height: 48, borderRadius: 12,
              display: 'grid', placeItems: 'center',
              background: gradFor(gym.name ?? gym.slug ?? 'G'),
              color: '#fff', fontFamily: 'var(--gf-font-display)', fontWeight: 800, fontSize: '1.2rem',
            }}
          >
            {(gym.name ?? gym.slug ?? 'G').charAt(0).toUpperCase()}
          </span>
          <div>
            <h1>{gym.name}</h1>
            <p>{gym.slug}.gymflow.ng · {place}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ButtonLink href="/superadmin/gyms" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={14} strokeWidth={1.75} />}>
            All gyms
          </ButtonLink>
          <SuperadminGymRowActions
            gymId={gym.id}
            slug={gym.slug}
            ownerEmail={gym.email ?? ''}
            status={gym.subscription_status ?? 'unknown'}
          />
        </div>
      </div>

      <section className="kpis">
        <Stat label="Members" value={memberCount ?? 0} accent="emerald" icon={Users} />
        <Stat label="Active" value={activeCount ?? 0} accent="blue" icon={UserCheck} />
        <Stat label="MRR · 30d" value={fmtNaira(mrr30)} accent="lime" icon={Banknote} />
        <Stat label="Lifetime paid" value={fmtNaira(lifetime)} accent="amber" icon={Wallet} />
      </section>

      <section className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Details</h3>
                <div className="sub">Tenant configuration</div>
              </div>
            </div>
            <div>
              {details.map((d) => (
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

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Recent settlements</h3>
                <div className="sub">Platform fees for this gym</div>
              </div>
            </div>
            {recent.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p, i) => {
                    const st = (p.payment_status as string | null) ?? 'pending';
                    const success = st === 'successful';
                    const badge = success
                      ? { cls: 'gf-badge-success', label: 'Settled' }
                      : st === 'pending'
                        ? { cls: 'gf-badge-warning', label: 'Pending' }
                        : { cls: 'gf-badge-danger', label: SETTLE_LABEL[st] ?? st };
                    return (
                      <tr key={`${p.created_at ?? i}-${i}`}>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>{fmtDate(p.created_at)}</td>
                        <td style={{ textTransform: 'capitalize', color: 'var(--gf-text-secondary)' }}>{p.plan ?? '—'}</td>
                        <td>
                          <span className={`gf-badge ${badge.cls}`}>
                            <span className="gf-dot" />
                            {badge.label}
                          </span>
                        </td>
                        <td className="naira" style={{ textAlign: 'right', color: success ? 'var(--gf-success)' : 'var(--gf-text)' }}>
                          {success ? '+' : ''}{fmtNaira(Number(p.amount ?? 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={Receipt} title="No settlements yet" message="Platform fees for this gym appear here as they settle." />
            )}
          </div>
        </div>
      </section>

      <div className="panel" style={{ marginTop: 16 }}>
        <Link href={`https://${gym.slug}.gymflow.ng/admin/dashboard`} target="_blank" rel="noreferrer" className="gf-link" style={{ fontWeight: 600 }}>
          Open {gym.name}&rsquo;s admin dashboard ↗
        </Link>
      </div>
    </div>
  );
}

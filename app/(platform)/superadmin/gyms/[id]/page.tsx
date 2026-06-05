import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { daysAgoIso } from '@/lib/dates';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { ButtonLink } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SuperadminGymRowActions } from '../../gym-row-actions';
import { ArrowLeft, Users, UserCheck, Banknote, Wallet, Receipt } from 'lucide-react';

// gyms.subscription_status ∈ trial|active|past_due|cancelled (lib/actions/platform.ts).
const STATUS_META: Record<string, { label: string; tone: 'on' | 'warn' | 'off' | 'neutral' }> = {
  active: { label: 'Active', tone: 'on' },
  trial: { label: 'Trial', tone: 'warn' },
  past_due: { label: 'Past due', tone: 'off' },
  cancelled: { label: 'Cancelled', tone: 'off' },
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

  const meta = STATUS_META[gym.subscription_status ?? ''] ?? { label: gym.subscription_status ?? '—', tone: 'neutral' as const };
  const place = [gym.city, gym.state].filter(Boolean).join(', ') || '—';

  const details: { label: string; value: ReactNode }[] = [
    { label: 'Plan', value: <span style={{ textTransform: 'capitalize' }}>{gym.subscription_plan ?? '—'}</span> },
    { label: 'Status', value: <StatusPill tone={meta.tone}>{meta.label}</StatusPill> },
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
      <PageHeader
        title={gym.name}
        subtitle={`${gym.slug}.gymflow.ng · ${place}`}
        actions={
          <>
            <ButtonLink href="/superadmin/gyms" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
              Back
            </ButtonLink>
            <SuperadminGymRowActions
              gymId={gym.id}
              slug={gym.slug}
              ownerEmail={gym.email ?? ''}
              status={gym.subscription_status ?? 'unknown'}
            />
          </>
        }
      />

      <StatGrid>
        <Stat label="Members" value={memberCount ?? 0} icon={Users} accent="emerald" />
        <Stat label="Active" value={activeCount ?? 0} icon={UserCheck} accent="blue" />
        <Stat label="MRR · 30d" value={fmtNaira(mrr30)} icon={Banknote} accent="purple" />
        <Stat label="Lifetime paid" value={fmtNaira(lifetime)} icon={Wallet} accent="amber" />
      </StatGrid>

      <div className="adm-dash-row">
        <Card>
          <CardHeader title="Details" />
          <ul className="gf-list">
            {details.map((d) => (
              <li key={d.label} className="gf-list-row">
                <span className="gf-table-meta">{d.label}</span>
                <span style={{ fontWeight: 600, textAlign: 'right' }}>{d.value}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Recent settlements" subtitle="Platform fees for this gym" />
          {recent.length > 0 ? (
            <div className="gf-table-wrap">
              <table role="table" className="gf-table gf-table-cards">
                <thead>
                  <tr role="row">
                    <th>Date</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {recent.map((p, i) => {
                    const st = (p.payment_status as string | null) ?? 'pending';
                    return (
                      <tr role="row" key={`${p.created_at ?? i}-${i}`}>
                        <td role="cell" data-label="Date">{fmtDate(p.created_at)}</td>
                        <td role="cell" data-label="Plan" style={{ textTransform: 'capitalize' }}>{p.plan ?? '—'}</td>
                        <td role="cell" data-label="Status">
                          <StatusPill tone={st === 'successful' ? 'on' : 'off'}>{SETTLE_LABEL[st] ?? st}</StatusPill>
                        </td>
                        <td role="cell" data-label="Amount" className="naira" style={{ textAlign: 'right' }}>
                          {fmtNaira(Number(p.amount ?? 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Receipt} title="No settlements yet" message="Platform fees for this gym appear here as they settle." />
          )}
        </Card>
      </div>

      <Card padded>
        <Link href={`https://${gym.slug}.gymflow.ng/admin/dashboard`} target="_blank" rel="noreferrer" className="gf-link" style={{ fontWeight: 600 }}>
          Open {gym.name}&rsquo;s admin dashboard ↗
        </Link>
      </Card>
    </div>
  );
}

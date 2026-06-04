import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { daysAgoIso } from '@/lib/dates';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { ButtonLink, Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, Search, Plus, Building2, CheckCircle2, Clock4, AlertTriangle, SearchX } from 'lucide-react';

// gyms.subscription_status is constrained to these four values
// (see lib/actions/platform.ts). Map each to a label + pill tone.
const STATUS_META: Record<string, { label: string; tone: 'on' | 'warn' | 'off' | 'neutral' }> = {
  active: { label: 'Active', tone: 'on' },
  trial: { label: 'Trial', tone: 'warn' },
  past_due: { label: 'Past due', tone: 'off' },
  cancelled: { label: 'Cancelled', tone: 'off' },
};

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'trial', label: 'Trial' },
  { key: 'past_due', label: 'Past due' },
];

type PageProps = { searchParams: Promise<{ q?: string; status?: string }> };

export default async function SuperadminGymsPage({ searchParams }: PageProps) {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const { q, status: statusParam } = await searchParams;
  const query = (q ?? '').trim();
  const status = statusParam && STATUS_META[statusParam] ? statusParam : '';

  // RLS grants platform_admins cross-gym read; the anon client is enough.
  const admin = await createClient();
  const since30 = daysAgoIso(30);

  // Directory query honours the search box + status chip. ilike terms are
  // stripped of the characters that would break PostgREST's or() grammar.
  let gymsQuery = admin
    .from('gyms')
    .select('id, name, slug, subscription_plan, subscription_status, city, state, created_at, email')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) gymsQuery = gymsQuery.eq('subscription_status', status);
  if (query) {
    const term = `%${query.replace(/[,()]/g, ' ')}%`;
    gymsQuery = gymsQuery.or(`name.ilike.${term},slug.ilike.${term},email.ilike.${term},city.ilike.${term}`);
  }

  const [
    { data: gyms },
    { count: totalGyms },
    { count: activeGyms },
    { count: trialGyms },
    { count: pastDueGyms },
  ] = await Promise.all([
    gymsQuery,
    admin.from('gyms').select('*', { count: 'exact', head: true }),
    admin.from('gyms').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
    admin.from('gyms').select('*', { count: 'exact', head: true }).eq('subscription_status', 'trial'),
    admin.from('gyms').select('*', { count: 'exact', head: true }).eq('subscription_status', 'past_due'),
  ]);

  // Per-gym member roster + trailing-30d platform fees, scoped to the gyms on
  // screen. Tallied in JS — same reduce-in-app pattern as the dashboard.
  const ids = (gyms ?? []).map((g) => g.id);
  const [{ data: links }, { data: pay30 }] = ids.length
    ? await Promise.all([
        admin.from('gym_member_links').select('gym_id').in('gym_id', ids),
        admin
          .from('platform_payments')
          .select('amount, gym_id')
          .eq('payment_status', 'successful')
          .gte('created_at', since30)
          .in('gym_id', ids),
      ])
    : [{ data: [] as { gym_id: string | null }[] }, { data: [] as { amount: number; gym_id: string }[] }];

  const memberCountByGym = new Map<string, number>();
  for (const l of links ?? []) {
    if (l.gym_id) memberCountByGym.set(l.gym_id, (memberCountByGym.get(l.gym_id) ?? 0) + 1);
  }
  const mrrByGym = new Map<string, number>();
  for (const p of pay30 ?? []) {
    if (p.gym_id) mrrByGym.set(p.gym_id, (mrrByGym.get(p.gym_id) ?? 0) + Number(p.amount ?? 0));
  }

  const chipHref = (s: string) => {
    const params = new URLSearchParams();
    if (s) params.set('status', s);
    if (query) params.set('q', query);
    const qs = params.toString();
    return qs ? `/superadmin/gyms?${qs}` : '/superadmin/gyms';
  };

  const subtitle = `${totalGyms ?? 0} gyms · ${trialGyms ?? 0} on trial · ${pastDueGyms ?? 0} past due`;

  return (
    <div className="gf-page">
      <PageHeader
        title="Gyms"
        subtitle={subtitle}
        actions={
          <>
            <ButtonLink href="/superadmin" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
              Back
            </ButtonLink>
            <ButtonLink href="/superadmin/gyms/new" variant="primary" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
              Onboard gym
            </ButtonLink>
          </>
        }
      />

      <StatGrid>
        <Stat label="Total gyms" value={totalGyms ?? 0} icon={Building2} accent="emerald" />
        <Stat label="Active" value={activeGyms ?? 0} icon={CheckCircle2} accent="blue" />
        <Stat label="On trial" value={trialGyms ?? 0} icon={Clock4} accent="amber" />
        <Stat label="Past due" value={pastDueGyms ?? 0} icon={AlertTriangle} accent="rose" />
      </StatGrid>

      <Card padded>
        <form style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {status && <input type="hidden" name="status" value={status} />}
          <div className="gf-form-group" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
            <input
              name="q"
              defaultValue={query}
              className="gf-input"
              placeholder="Search gyms, subdomains, owners…"
            />
          </div>
          <Button type="submit" variant="primary" leadingIcon={<Search size={16} strokeWidth={1.75} />}>
            Search
          </Button>
        </form>
        <div className="gf-chips" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Link key={f.key || 'all'} href={chipHref(f.key)} className={`gf-chip${status === f.key ? ' active' : ''}`}>
              {f.label}
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`${(gyms ?? []).length} gym${(gyms ?? []).length === 1 ? '' : 's'}`} />
        {(gyms ?? []).length > 0 ? (
          <div className="gf-table-wrap">
            <table role="table" className="gf-table gf-table-cards">
              <thead>
                <tr role="row">
                  <th>Gym</th>
                  <th>Plan</th>
                  <th>Members</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>MRR · 30d</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {(gyms ?? []).map((g) => {
                  const meta = STATUS_META[g.subscription_status ?? ''] ?? { label: g.subscription_status ?? '—', tone: 'neutral' as const };
                  const place = g.city ?? g.state ?? '';
                  return (
                    <tr role="row" key={g.id}>
                      <td role="cell">
                        <a
                          href={`https://${g.slug}.gymflow.ng/admin/dashboard`}
                          target="_blank"
                          rel="noreferrer"
                          className="gf-link"
                          style={{ fontWeight: 600 }}
                        >
                          {g.name}
                        </a>
                        <div className="gf-table-meta">{g.slug}.gymflow.ng{place ? ` · ${place}` : ''}</div>
                      </td>
                      <td role="cell" data-label="Plan" style={{ textTransform: 'capitalize' }}>{g.subscription_plan ?? '—'}</td>
                      <td role="cell" data-label="Members">{memberCountByGym.get(g.id) ?? 0}</td>
                      <td role="cell" data-label="Status">
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      </td>
                      <td role="cell" data-label="MRR · 30d" className="naira" style={{ textAlign: 'right' }}>
                        {fmtNaira(mrrByGym.get(g.id) ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={SearchX}
            title={query || status ? 'No gyms match' : 'No gyms yet'}
            message={query || status ? 'Try a different search or filter.' : 'Onboard the first gym to get started.'}
          />
        )}
      </Card>
    </div>
  );
}

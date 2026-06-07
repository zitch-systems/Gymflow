import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { daysAgoIso } from '@/lib/dates';
import { Stat } from '@/components/ui/stat';
import { ButtonLink, Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Search, Plus, Building2, CheckCircle2, Clock, AlertTriangle, SearchX } from 'lucide-react';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active:    { label: 'Active',     cls: 'gf-badge-success' },
  trial:     { label: 'Trial',      cls: 'gf-badge-warning' },
  past_due:  { label: 'Past due',   cls: 'gf-badge-danger' },
  cancelled: { label: 'Cancelled',  cls: 'gf-badge-neutral' },
  suspended: { label: 'Suspended',  cls: 'gf-badge-neutral' },
};

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'trial', label: 'Trial' },
  { key: 'past_due', label: 'Past due' },
];

const GRADS = [
  'linear-gradient(135deg, #11d18b, #07a86c)',
  'linear-gradient(135deg, #4080ff, #2a5cc0)',
  'linear-gradient(135deg, #a8d92e, #6a9c00)',
  'linear-gradient(135deg, #ffb020, #cc8a10)',
  'linear-gradient(135deg, #b67bf3, #7c45c0)',
  'linear-gradient(135deg, #ff4560, #cc2a40)',
  'linear-gradient(135deg, #00c896, #008e6c)',
];
const gradFor = (s: string) => GRADS[s.charCodeAt(0) % GRADS.length];

type PageProps = { searchParams: Promise<{ q?: string; status?: string }> };

export default async function SuperadminGymsPage({ searchParams }: PageProps) {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const { q, status: statusParam } = await searchParams;
  const query = (q ?? '').trim();
  const status = statusParam && STATUS_META[statusParam] ? statusParam : '';

  const admin = await createClient();
  const since30 = daysAgoIso(30);

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

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Gyms</h1>
          <p>{totalGyms ?? 0} total · {trialGyms ?? 0} on trial · {pastDueGyms ?? 0} past due</p>
        </div>
        <ButtonLink href="/superadmin/gyms/new" variant="primary" size="sm" leadingIcon={<Plus size={14} strokeWidth={2} />}>
          Onboard a gym
        </ButtonLink>
      </div>

      <section className="kpis">
        <Stat label="Total gyms" value={totalGyms ?? 0} accent="emerald" icon={Building2} />
        <Stat label="Active" value={activeGyms ?? 0} accent="blue" icon={CheckCircle2} />
        <Stat label="On trial" value={trialGyms ?? 0} accent="amber" icon={Clock} />
        <Stat label="Past due" value={pastDueGyms ?? 0} accent="rose" icon={AlertTriangle} />
      </section>

      <div className="panel">
        <div className="panel-h">
          <div>
            <h3>{(gyms ?? []).length} gym{(gyms ?? []).length === 1 ? '' : 's'}</h3>
            <div className="sub">Click a gym to inspect their tenant</div>
          </div>
          <nav className="seg" aria-label="Filter gyms">
            {FILTERS.map((f) => (
              <Link key={f.key || 'all'} href={chipHref(f.key)} className={status === f.key ? 'on' : ''}>
                {f.label}
              </Link>
            ))}
          </nav>
        </div>

        <form className="toolbar" style={{ marginTop: 0 }}>
          {status && <input type="hidden" name="status" value={status} />}
          <div className="search">
            <input
              name="q"
              defaultValue={query}
              className="gf-input"
              placeholder="Search gyms, subdomains, owners…"
            />
          </div>
          <div style={{ flex: 1 }} />
          <Button type="submit" variant="primary" size="sm" leadingIcon={<Search size={14} strokeWidth={1.75} />}>
            Search
          </Button>
        </form>

        {(gyms ?? []).length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Gym</th>
                <th>Plan</th>
                <th>Members</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>MRR · 30d</th>
              </tr>
            </thead>
            <tbody>
              {(gyms ?? []).map((g) => {
                const meta = STATUS_META[g.subscription_status ?? ''] ?? { label: g.subscription_status ?? '—', cls: 'gf-badge-neutral' };
                const place = g.city ?? g.state ?? '';
                return (
                  <tr key={g.id}>
                    <td>
                      <Link href={`/superadmin/gyms/${g.id}`} className="gname" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <span className="sq" style={{ background: gradFor(g.name ?? g.slug ?? 'G') }}>
                          {(g.name ?? g.slug ?? 'G').charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <strong>{g.name}</strong>
                          <small>{g.slug}.gymflow.ng{place ? ` · ${place}` : ''}</small>
                        </div>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--gf-text-secondary)', textTransform: 'capitalize' }}>{g.subscription_plan ?? '—'}</td>
                    <td className="naira" style={{ color: 'var(--gf-text-secondary)' }}>{(memberCountByGym.get(g.id) ?? 0).toLocaleString()}</td>
                    <td>
                      <span className={`gf-badge ${meta.cls}`}>
                        <span className="gf-dot" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="naira" style={{ textAlign: 'right' }}>{fmtNaira(mrrByGym.get(g.id) ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={SearchX}
            title={query || status ? 'No gyms match' : 'No gyms yet'}
            message={query || status ? 'Try a different search or filter.' : 'Onboard the first gym to get started.'}
          />
        )}
      </div>
    </div>
  );
}

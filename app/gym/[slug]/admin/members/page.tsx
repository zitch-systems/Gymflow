import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, fmtNaira } from '@/lib/format';
import { MembersSearch } from './members-search';
import { ExportMembersCsvButton } from './export-csv-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Plus, UserPlus, Users, Clock, UserX, TrendingUp } from 'lucide-react';

type StatusFilter = 'all' | 'active' | 'expiring' | 'expired';
const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'expiring', 'expired'];
const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
};

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; st?: string }>;
};

export default async function AdminMembersPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const sp = await searchParams;
  const query = sp.q?.trim() ?? '';
  const statusFilter: StatusFilter = STATUS_FILTERS.includes(sp.st as StatusFilter) ? (sp.st as StatusFilter) : 'all';

  const supabase = await createClient();

  const { data: links } = await supabase
    .from('gym_member_links')
    .select('user_id, joined_at, status')
    .eq('gym_id', gym.id)
    .order('joined_at', { ascending: false })
    .limit(500);

  const memberIds = (links ?? []).map((l) => l.user_id).filter(Boolean) as string[];

  const profilesPromise =
    memberIds.length > 0
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email, phone, photo_url').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; photo_url: string | null }> });

  const membershipsPromise =
    memberIds.length > 0
      ? supabase
          .from('memberships')
          .select('member_id, end_date, status, plan_id')
          .eq('gym_id', gym.id)
          .in('member_id', memberIds)
          .order('end_date', { ascending: false })
      : Promise.resolve({ data: [] as Array<{ member_id: string | null; end_date: string; status: string | null; plan_id: string | null }> });

  const plansPromise = supabase.from('membership_plans').select('id, name, price').eq('gym_id', gym.id);

  const [{ data: profiles }, { data: memberships }, { data: plans }] = await Promise.all([
    profilesPromise,
    membershipsPromise,
    plansPromise,
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const planById = new Map((plans ?? []).map((p) => [p.id, p]));
  const activeByMember = new Map<string, { end_date: string; status: string | null; plan_id: string | null }>();
  for (const m of memberships ?? []) {
    if (!m.member_id) continue;
    if (!activeByMember.has(m.member_id)) activeByMember.set(m.member_id, m);
  }

  const baseRows = (links ?? []).map((l) => {
    const p = l.user_id ? profileById.get(l.user_id) : null;
    const m = l.user_id ? activeByMember.get(l.user_id) : null;
    const plan = m?.plan_id ? planById.get(m.plan_id) : null;
    const composed = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
    const name = p?.full_name || composed || p?.email || '—';
    return {
      userId: l.user_id ?? '',
      name,
      initial: name.charAt(0).toUpperCase(),
      email: p?.email ?? '—',
      phone: p?.phone ?? '—',
      photoUrl: p?.photo_url ?? null,
      joined: l.joined_at ?? null,
      expiry: m?.end_date ?? null,
      planName: plan?.name ?? '—',
      planValue: plan?.price ?? null,
      status: m?.status ?? l.status ?? null,
    };
  });

  const matchesQuery = (r: (typeof baseRows)[number]) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.phone.toLowerCase().includes(q);
  };

  const statusOf = (r: (typeof baseRows)[number]): 'active' | 'expiring' | 'expired' => {
    const left = daysLeft(r.expiry);
    const isExpired = left <= 0 || r.status === 'cancelled';
    if (isExpired) return 'expired';
    if (left <= 7) return 'expiring';
    return 'active';
  };

  const stats = { active: 0, expiring: 0, lapsed: 0, fresh: 0 };
  const DAY_MS = 86_400_000;
  const nowMs = new Date().getTime();
  for (const r of baseRows) {
    const s = statusOf(r);
    if (s === 'active' || s === 'expiring') stats.active++;
    if (s === 'expiring') stats.expiring++;
    if (s === 'expired') stats.lapsed++;
    if (r.joined && nowMs - new Date(r.joined).getTime() <= 30 * DAY_MS) stats.fresh++;
  }

  const rows = baseRows.filter((r) => {
    if (!matchesQuery(r)) return false;
    if (statusFilter === 'all') return true;
    return statusOf(r) === statusFilter;
  });

  const STATUS_BADGE: Record<'active' | 'expiring' | 'expired', { cls: string; label: string }> = {
    active: { cls: 'gf-badge-success', label: 'Active' },
    expiring: { cls: 'gf-badge-warning', label: 'Expiring' },
    expired: { cls: 'gf-badge-danger', label: 'Expired' },
  };

  const filterHref = (f: StatusFilter) => {
    const params = new URLSearchParams();
    if (f !== 'all') params.set('st', f);
    if (query) params.set('q', query);
    const s = params.toString();
    return s ? `/admin/members?${s}` : '/admin/members';
  };

  const renewsLabel = (expiry: string | null) => {
    if (!expiry) return '—';
    const left = daysLeft(expiry);
    if (left <= 0) return `${fmtDate(expiry)} (lapsed)`;
    if (left <= 14) return `in ${left} day${left === 1 ? '' : 's'}`;
    return fmtDate(expiry);
  };

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Members</h1>
          <p>
            {stats.active} active · {stats.expiring} expiring this week · {stats.lapsed} lapsed
          </p>
        </div>
        <nav className="seg" aria-label="Filter members">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f}
              href={filterHref(f)}
              className={statusFilter === f ? 'on' : ''}
              aria-current={statusFilter === f ? 'page' : undefined}
            >
              {FILTER_LABEL[f]}
            </Link>
          ))}
        </nav>
      </div>

      <section className="kpis">
        <div className="kpi">
          <div className="kpi-top">
            <div className="kpi-ic" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
              <Users strokeWidth={1.75} />
            </div>
          </div>
          <div className="kpi-val">{stats.active}</div>
          <div className="kpi-lbl">Active members</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <div className="kpi-ic" style={{ background: 'var(--gf-warning-soft)', color: 'var(--gf-warning)' }}>
              <Clock strokeWidth={1.75} />
            </div>
          </div>
          <div className="kpi-val">{stats.expiring}</div>
          <div className="kpi-lbl">Expiring this week</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <div className="kpi-ic" style={{ background: 'var(--gf-danger-soft)', color: 'var(--gf-danger)' }}>
              <UserX strokeWidth={1.75} />
            </div>
          </div>
          <div className="kpi-val">{stats.lapsed}</div>
          <div className="kpi-lbl">Lapsed</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <div className="kpi-ic" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}>
              <TrendingUp strokeWidth={1.75} />
            </div>
          </div>
          <div className="kpi-val">{stats.fresh}</div>
          <div className="kpi-lbl">New this month</div>
        </div>
      </section>

      <div className="panel">
        <div className="toolbar">
          <MembersSearch defaultValue={query} />
          <div style={{ flex: 1 }} />
          <ExportMembersCsvButton slug={slug} />
          <ButtonLink href="/admin/members/new" variant="primary" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
            Add member
          </ButtonLink>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title={query || statusFilter !== 'all' ? 'No members match' : 'No members yet'}
            message={query || statusFilter !== 'all'
              ? 'Try a different filter or search.'
              : 'Members appear here after they sign up on the join page or are added by staff.'}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Renews</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = statusOf(r);
                  const badge = STATUS_BADGE[s];
                  return (
                    <tr key={r.userId} onClick={undefined}>
                      <td>
                        <Link href={`/admin/members/${r.userId}`} className="who" style={{ textDecoration: 'none', color: 'inherit' }}>
                          <span className="gf-avatar gf-avatar-sm">
                            {r.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.photoUrl} alt="" />
                            ) : r.initial}
                          </span>
                          <div>
                            <strong>{r.name}</strong>
                            <small>{r.email}</small>
                          </div>
                        </Link>
                      </td>
                      <td>{r.planName}</td>
                      <td>
                        <span className={`gf-badge ${badge.cls}`}>
                          <span className="gf-dot" />
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{fmtDate(r.joined)}</td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{renewsLabel(r.expiry)}</td>
                      <td style={{ textAlign: 'right' }} className="naira">{r.planValue != null ? fmtNaira(r.planValue) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

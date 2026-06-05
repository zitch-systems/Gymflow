import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft } from '@/lib/format';
import { MembersSearch } from './members-search';
import { ExportMembersCsvButton } from './export-csv-button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { ButtonLink } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Plus, UserPlus, Users, Clock4, UserX } from 'lucide-react';

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

  const plansPromise = supabase.from('membership_plans').select('id, name').eq('gym_id', gym.id);

  const [{ data: profiles }, { data: memberships }, { data: plans }] = await Promise.all([
    profilesPromise,
    membershipsPromise,
    plansPromise,
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const planNameById = new Map((plans ?? []).map((p) => [p.id, p.name]));
  const activeByMember = new Map<string, { end_date: string; status: string | null; plan_id: string | null }>();
  for (const m of memberships ?? []) {
    if (!m.member_id) continue;
    if (!activeByMember.has(m.member_id)) activeByMember.set(m.member_id, m);
  }

  const baseRows = (links ?? []).map((l) => {
    const p = l.user_id ? profileById.get(l.user_id) : null;
    const m = l.user_id ? activeByMember.get(l.user_id) : null;
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
      planName: m?.plan_id ? (planNameById.get(m.plan_id) ?? '—') : '—',
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

  // KPI counts read off the full member set (independent of the filter) so the
  // numbers are stable as you switch tabs.
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

  const STATUS_TONE: Record<'active' | 'expiring' | 'expired', 'on' | 'off'> = {
    active: 'on',
    expiring: 'on',
    expired: 'off',
  };
  const STATUS_LABEL: Record<'active' | 'expiring' | 'expired', string> = {
    active: 'Active',
    expiring: 'Expiring',
    expired: 'Expired',
  };

  const filterHref = (f: StatusFilter) => {
    const sp = new URLSearchParams();
    if (f !== 'all') sp.set('st', f);
    if (query) sp.set('q', query);
    const s = sp.toString();
    return s ? `/admin/members?${s}` : '/admin/members';
  };

  return (
    <div className="gf-page">
      <PageHeader
        title="Members"
        subtitle={`${stats.active} active · ${stats.expiring} expiring this week · ${stats.lapsed} lapsed`}
        actions={
          <>
            <MembersSearch defaultValue={query} />
            <ExportMembersCsvButton slug={slug} />
            <ButtonLink href="/admin/members/new" variant="primary" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
              Add member
            </ButtonLink>
          </>
        }
      />

      <nav className="adm-seg" aria-label="Filter members">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f}
            href={filterHref(f)}
            className={`adm-seg-btn${statusFilter === f ? ' on' : ''}`}
            aria-current={statusFilter === f ? 'page' : undefined}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </nav>

      <StatGrid>
        <Stat label="Active members" value={stats.active} accent="emerald" icon={Users} />
        <Stat label="Expiring this week" value={stats.expiring} accent="amber" icon={Clock4} />
        <Stat label="Lapsed" value={stats.lapsed} accent="rose" icon={UserX} />
        <Stat label="New (30d)" value={stats.fresh} accent="blue" icon={UserPlus} />
      </StatGrid>

      <Card>
        <div className="gf-table-wrap">
          <table role="table" className="gf-table gf-table-cards">
            <thead>
              <tr role="row">
                <th>Member</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Renews</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.length === 0 ? (
                <tr role="row">
                  <td role="cell" colSpan={5}>
                    <EmptyState
                      icon={UserPlus}
                      title={query || statusFilter !== 'all' ? 'No members match' : 'No members yet'}
                      message={query || statusFilter !== 'all'
                        ? 'Try a different filter or search.'
                        : 'Members appear here after they sign up on the join page or are added by staff.'}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const left = daysLeft(r.expiry);
                  const s = statusOf(r);
                  return (
                    <tr role="row" key={r.userId}>
                      <td role="cell" className="gf-td-primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span
                            className="gf-avatar gf-avatar-sm"
                            style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}
                          >
                            {r.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.photoUrl} alt="" />
                            ) : r.initial}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <Link href={`/admin/members/${r.userId}`} className="gf-link" style={{ fontWeight: 600 }}>
                              {r.name}
                            </Link>
                            <div className="gf-table-meta">{r.email}</div>
                          </div>
                        </div>
                      </td>
                      <td role="cell" data-label="Plan">{r.planName}</td>
                      <td role="cell" data-label="Status">
                        <StatusPill tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}{s === 'active' || s === 'expiring' ? ` · ${left}d` : ''}</StatusPill>
                      </td>
                      <td role="cell" data-label="Joined">{fmtDate(r.joined)}</td>
                      <td role="cell" data-label="Renews">{fmtDate(r.expiry)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

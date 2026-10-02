import Link from 'next/link';
import { Users, Clock, UserX, UserPlus, Search, Download, ChevronRight, Snowflake } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';
import { InviteLinkButton } from '@/components/admin/invite-link';
import { Pagination } from '@/components/pagination';
import { parseGymReportingSummary, parseRosterPage, type ReportingRpcClient } from '@/lib/reporting';

export const metadata = { title: 'Members' };

const FILTERS = [['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['scheduled', 'Scheduled'], ['frozen', 'Frozen'], ['expired', 'Expired'], ['freeze', 'Freeze requests']] as const;
type FilterKey = (typeof FILTERS)[number][0];
const PAGE_SIZE = 50;

export default async function AdminMembers({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const filter: FilterKey = (FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'all');
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const from = (page - 1) * PAGE_SIZE;
  const rpc = supabase as unknown as ReportingRpcClient;
  const [summaryRes, rosterRes] = await Promise.all([
    rpc.rpc('gym_reporting_summary', { p_gym_id: gym.id }),
    rpc.rpc('gym_member_roster', {
      p_gym_id: gym.id,
      p_search: q || null,
      p_filter: filter,
      p_offset: from,
      p_limit: PAGE_SIZE,
    }),
  ]);
  if (summaryRes.error) throw new Error(`gym_reporting_summary failed: ${summaryRes.error.message}`);
  if (rosterRes.error) throw new Error(`gym_member_roster failed: ${rosterRes.error.message}`);
  const summary = parseGymReportingSummary(summaryRes.data);
  const roster = parseRosterPage(rosterRes.data);
  const active = summary.activeAccess;
  const expiring = summary.expiring;
  const fresh = summary.fresh;
  const freezePending = summary.freezePending;
  const lapsed = summary.lapsed;

  type Row = { id: string; name: string; email: string; initial: string; plan: string; status: [string, string]; joined: string; renews: string; value: string; bucket: FilterKey };
  const rows: Row[] = roster.rows.map((member) => {
    const name = member.fullName || [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email || 'Member';
    const remaining = member.endDate ? daysLeft(member.endDate) : 0;
    const expSoon = member.displayState === 'active' && remaining <= 7;
    let status: [string, string];
    let bucket: FilterKey;
    if (member.displayState === 'freeze_pending') { status = ['gf-badge-warning', 'Freeze pending']; bucket = 'freeze'; }
    else if (member.displayState === 'frozen') { status = ['gf-badge-neutral', 'Frozen']; bucket = 'frozen'; }
    else if (member.displayState === 'scheduled') { status = ['gf-badge-neutral', 'Scheduled']; bucket = 'scheduled'; }
    else if (expSoon) { status = ['gf-badge-warning', 'Expiring']; bucket = 'expiring'; }
    else if (member.displayState === 'active' && member.subscriptionStatus === 'past_due') { status = ['gf-badge-warning', 'Payment due']; bucket = 'active'; }
    else if (member.displayState === 'active') { status = ['gf-badge-success', 'Active']; bucket = 'active'; }
    else { status = ['gf-badge-danger', 'Expired']; bucket = 'expired'; }
    return {
      id: member.memberId, name, email: member.email ?? '—', initial: name.charAt(0).toUpperCase(),
      plan: member.planName ?? '—', status, bucket,
      joined: member.joinedAt ? fmtDate(member.joinedAt) : '—',
      renews: member.displayState === 'active' && member.endDate
        ? (remaining <= 7 ? `in ${remaining} day${remaining === 1 ? '' : 's'}` : fmtDate(member.endDate))
        : member.displayState === 'scheduled' && member.startDate ? `starts ${fmtDate(member.startDate)}` : '—',
      value: member.planPrice !== null ? fmtNaira(member.planPrice) : '—',
    };
  });

  const KPIS = [
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: String(active), lbl: 'Active members' },
    { icon: Clock, fg: '#ffb020', bg: '#ffb0201f', val: String(expiring), lbl: 'Expiring this week' },
    { icon: UserX, fg: '#ff4560', bg: '#ff45601f', val: String(lapsed), lbl: 'Lapsed' },
    { icon: UserPlus, fg: '#4080ff', bg: '#4080ff1f', val: String(fresh), lbl: 'New this month' },
    { icon: Snowflake, fg: '#4dc4ff', bg: '#4dc4ff1f', val: String(freezePending), lbl: 'Freeze requests' },
  ];

  return (
    <>
      <div className="page-h">
        <div><h1>Members</h1><p>{active} active · {expiring} expiring this week · {lapsed} lapsed{freezePending ? ` · ${freezePending} freeze request${freezePending === 1 ? '' : 's'}` : ''}</p></div>
        <div className="seg">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={`/admin/members?${new URLSearchParams({ ...(k !== 'all' && { f: k }), ...(q && { q: sp.q ?? '' }) })}`} className={filter === k ? 'on' : ''} style={{ textDecoration: 'none' }}>{label}</Link>
          ))}
        </div>
      </div>

      <section className="kpis">
        {KPIS.map((k) => {
          const Icon = k.icon;
          return (
            <div className="kpi" key={k.lbl}>
              <div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div>
              <div className="kpi-val">{k.val}</div>
              <div className="kpi-lbl">{k.lbl}</div>
            </div>
          );
        })}
      </section>

      <div className="panel">
        <div className="toolbar">
          <form className="search" action="/admin/members" style={{ display: 'flex' }}>
            {filter !== 'all' && <input type="hidden" name="f" value={filter} />}
            <Search strokeWidth={1.75} /><input name="q" defaultValue={sp.q ?? ''} placeholder="Search by name or email…" aria-label="Search members" />
          </form>
          <div style={{ flex: 1 }} />
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- route handler streaming a CSV download; <Link> would client-navigate */}
          <a className="gf-btn gf-btn-secondary gf-btn-sm" href="/admin/members/export" style={{ textDecoration: 'none' }}><Download strokeWidth={1.9} size={15} /> Export</a>
          <InviteLinkButton slug={gym.slug} />
          <Link href="/admin/members/new" className="gf-btn gf-btn-primary gf-btn-sm"><UserPlus strokeWidth={1.9} size={15} /> Add member</Link>
        </div>
        {rows.length === 0 ? (
          <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>{q || filter !== 'all' ? 'No matches' : 'No members yet'}</h3><p>{q ? 'Try a different search.' : filter !== 'all' ? 'No members in this state on this page.' : 'Members appear here after they sign up or are added.'}</p></div>
        ) : (
          <>
            <div className="tbl-scroll">
              <table className="tbl">
                <thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Joined</th><th>Renews</th><th style={{ textAlign: 'right' }}>Value</th><th aria-hidden /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="rowlink">
                      <td><Link href={`/admin/members/${r.id}`} className="who"><span className="gf-avatar gf-avatar-sm">{r.initial}</span><div><strong>{r.name}</strong><small>{r.email}</small></div></Link></td>
                      <td>{r.plan}</td>
                      <td><span className={`gf-badge ${r.status[0]}`}>{r.status[1]}</span></td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{r.joined}</td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{r.renews}</td>
                      <td className="naira" style={{ textAlign: 'right' }}>{r.value}</td>
                      <td style={{ textAlign: 'right', width: 36 }}><Link href={`/admin/members/${r.id}`} className="row-chev" aria-label={`View ${r.name}`}><ChevronRight strokeWidth={2} size={16} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination basePath="/admin/members" params={{ f: filter !== 'all' ? filter : undefined, q: q || undefined }} page={page} pageSize={PAGE_SIZE} total={roster.total} />
          </>)}
      </div>
    </>
  );
}

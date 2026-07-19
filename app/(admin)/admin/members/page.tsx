import Link from 'next/link';
import { Users, Clock, UserX, UserPlus, Search, Download, ChevronRight, Snowflake } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft, watDateISO } from '@/lib/format';
import { InviteLinkButton } from '@/components/admin/invite-link';
import { Pagination } from '@/components/pagination';

export const metadata = { title: 'Members' };

const FILTERS = [['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['freeze', 'Freeze requests']] as const;
type FilterKey = (typeof FILTERS)[number][0];
const PAGE_SIZE = 50;

export default async function AdminMembers({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const filter: FilterKey = (FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'all');
  const q = (sp.q ?? '').trim();
  const needle = q.toLowerCase();
  const page = Math.max(1, Number(sp.page) || 1);
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const today = watDateISO();
  const in7 = watDateISO(new Date(Date.now() + 7 * 86_400_000));
  const monthAgoIso = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // ── Accurate KPI counts over the WHOLE roster (dedicated count queries) ──
  // Previously these were derived from a 200-row fetch, so every count was
  // wrong for gyms past 200 members. active/expiring count active subscriptions
  // (≈ one per member); lapsed is the roster minus those. Scale-safe: counts,
  // not row fetches.
  const [
    { count: rosterCount }, { count: freshCount }, { count: freezeCount },
    { count: activeCount }, { count: expiringCount },
  ] = await Promise.all([
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('is_active', true),
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('is_active', true).gte('joined_at', monthAgoIso),
    supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('status', 'pause_requested'),
    supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('status', 'active').gt('end_date', in7),
    supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('status', 'active').gte('end_date', today).lte('end_date', in7),
  ]);
  const active = activeCount ?? 0;
  const expiring = expiringCount ?? 0;
  const fresh = freshCount ?? 0;
  const freezePending = freezeCount ?? 0;
  const lapsed = Math.max(0, (rosterCount ?? 0) - active - expiring);

  // ── Paginated table window ──
  // Search resolves to member ids server-side (name/email) so it spans the whole
  // roster, not a truncated page. Without search we page the roster by join date.
  let matchIds: string[] | null = null;
  if (needle) {
    const safe = q.replace(/[%,()*\\]/g, ' ').trim();
    const { data: hits } = safe
      ? await supabase.from('profiles').select('id').or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(500)
      : { data: [] as { id: string }[] };
    matchIds = (hits ?? []).map((h) => h.id);
  }

  const from = (page - 1) * PAGE_SIZE;
  let linkQuery = supabase
    .from('gym_member_links')
    .select('user_id, member_id, joined_at', { count: 'exact' })
    .eq('gym_id', gym.id)
    .eq('is_active', true);
  if (matchIds) linkQuery = linkQuery.in('member_id', matchIds.length ? matchIds : ['00000000-0000-0000-0000-000000000000']);
  const { data: links, count: listCount } = await linkQuery
    .order('joined_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const memberIds = [...new Set((links ?? []).map((l) => l.member_id ?? l.user_id).filter(Boolean) as string[])];

  const [{ data: profiles }, { data: subs }, { data: plans }] = await Promise.all([
    memberIds.length
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email').in('id', memberIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null }[] }),
    memberIds.length
      ? supabase.from('member_subscriptions').select('member_id, plan_id, status, end_date').eq('gym_id', gym.id).in('member_id', memberIds)
      : Promise.resolve({ data: [] as { member_id: string; plan_id: string | null; status: string | null; end_date: string | null }[] }),
    supabase.from('membership_plans').select('id, name, price').eq('gym_id', gym.id),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const planById = new Map((plans ?? []).map((p) => [p.id, p]));
  const subByMember = new Map((subs ?? []).map((s) => [s.member_id, s]));

  type Row = { id: string; name: string; email: string; initial: string; plan: string; status: [string, string]; joined: string; renews: string; value: string; bucket: FilterKey };
  const windowRows: Row[] = (links ?? []).map((l) => {
    const mid = (l.member_id ?? l.user_id) as string;
    const p = profileById.get(mid);
    const name = p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.email || 'Member';
    const sub = subByMember.get(mid);
    const plan = sub?.plan_id ? planById.get(sub.plan_id) : null;
    const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
    const isActive = sub?.status === 'active' && (sub.end_date ?? '') >= today;
    const expSoon = isActive && remaining <= 7;
    const pending = sub?.status === 'pause_requested';
    let status: [string, string];
    let bucket: FilterKey;
    if (pending) { status = ['gf-badge-warning', 'Freeze pending']; bucket = 'freeze'; }
    else if (expSoon) { status = ['gf-badge-warning', 'Expiring']; bucket = 'expiring'; }
    else if (isActive) { status = ['gf-badge-success', 'Active']; bucket = 'active'; }
    else { status = ['gf-badge-danger', 'Expired']; bucket = 'expired'; }
    return {
      id: mid, name, email: p?.email ?? '—', initial: name.charAt(0).toUpperCase(),
      plan: plan?.name ?? '—', status, bucket,
      joined: l.joined_at ? fmtDate(l.joined_at) : '—',
      renews: isActive ? (remaining <= 7 ? `in ${remaining} day${remaining === 1 ? '' : 's'}` : fmtDate(sub!.end_date)) : '—',
      value: plan ? fmtNaira(Number(plan.price)) : '—',
    };
  });

  // The seg filter refines the current page (bucket is a per-member derived
  // status; the KPI cards above carry the authoritative whole-roster totals).
  const rows = filter === 'all' ? windowRows : windowRows.filter((r) => r.bucket === filter);

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
            <Pagination basePath="/admin/members" params={{ f: filter !== 'all' ? filter : undefined, q: q || undefined }} page={page} pageSize={PAGE_SIZE} total={listCount ?? 0} />
          </>)}
      </div>
    </>
  );
}

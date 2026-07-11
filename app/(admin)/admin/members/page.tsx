import Link from 'next/link';
import { Users, Clock, UserX, UserPlus, Search, Download, ChevronRight, Snowflake } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';
import { InviteLinkButton } from '@/components/admin/invite-link';

export const metadata = { title: 'Members' };

type Row = {
  id: string; name: string; email: string; initial: string;
  plan: string; status: [string, string]; joined: string; renews: string; value: string;
};

const FILTERS = [['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['freeze', 'Freeze requests']] as const;
type FilterKey = (typeof FILTERS)[number][0];

export default async function AdminMembers({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const sp = await searchParams;
  const filter: FilterKey = (FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'all');
  const q = (sp.q ?? '').trim().toLowerCase();
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const { data: links } = await supabase
    .from('gym_member_links')
    .select('user_id, member_id, joined_at, is_active')
    .eq('gym_id', gym.id)
    .order('joined_at', { ascending: false })
    .limit(200);

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

  const today = new Date().toISOString().slice(0, 10);
  let active = 0, expiring = 0, lapsed = 0, fresh = 0, freezePending = 0;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);

  const all: (Row & { bucket: FilterKey })[] = (links ?? []).map((l) => {
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
    // Pending freeze wins the status pill so the row is obvious in the "All"
    // list too; the row still counts toward its underlying active/expiring
    // bucket via the KPI cards below.
    if (pending) { status = ['gf-badge-warning', 'Freeze pending']; bucket = 'freeze'; freezePending++; }
    else if (expSoon) { status = ['gf-badge-warning', 'Expiring']; bucket = 'expiring'; expiring++; }
    else if (isActive) { status = ['gf-badge-success', 'Active']; bucket = 'active'; active++; }
    else { status = ['gf-badge-danger', 'Expired']; bucket = 'expired'; lapsed++; }
    if (l.joined_at && new Date(l.joined_at) >= monthAgo) fresh++;
    return {
      id: mid,
      name,
      email: p?.email ?? '—',
      initial: name.charAt(0).toUpperCase(),
      plan: plan?.name ?? '—',
      status,
      bucket,
      joined: l.joined_at ? fmtDate(l.joined_at) : '—',
      renews: isActive ? (remaining <= 7 ? `in ${remaining} day${remaining === 1 ? '' : 's'}` : fmtDate(sub!.end_date)) : '—',
      value: plan ? fmtNaira(Number(plan.price)) : '—',
    };
  });

  // KPI counts cover the whole roster; the table honors the seg filter + search.
  const rows = all.filter((r) =>
    (filter === 'all' || r.bucket === filter) &&
    (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)));

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
          <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>{q || filter !== 'all' ? 'No matches' : 'No members yet'}</h3><p>{q || filter !== 'all' ? 'Try a different search or filter.' : 'Members appear here after they sign up or are added.'}</p></div>
        ) : (
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
        )}
      </div>
    </>
  );
}

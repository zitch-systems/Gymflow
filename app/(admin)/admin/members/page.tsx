import { Users, Clock, UserX, UserPlus, TrendingUp, Search, Filter, Download } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';

export const metadata = { title: 'Members' };

type Row = {
  id: string; name: string; email: string; initial: string;
  plan: string; status: [string, string]; joined: string; renews: string; value: string;
};

export default async function AdminMembers() {
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
  let active = 0, expiring = 0, lapsed = 0, fresh = 0;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);

  const rows: Row[] = (links ?? []).map((l) => {
    const mid = (l.member_id ?? l.user_id) as string;
    const p = profileById.get(mid);
    const name = p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.email || 'Member';
    const sub = subByMember.get(mid);
    const plan = sub?.plan_id ? planById.get(sub.plan_id) : null;
    const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
    const isActive = sub?.status === 'active' && (sub.end_date ?? '') >= today;
    const expSoon = isActive && remaining <= 7;
    let status: [string, string];
    if (expSoon) { status = ['gf-badge-warning', 'Expiring']; expiring++; }
    else if (isActive) { status = ['gf-badge-success', 'Active']; active++; }
    else { status = ['gf-badge-danger', 'Expired']; lapsed++; }
    if (l.joined_at && new Date(l.joined_at) >= monthAgo) fresh++;
    return {
      id: l.user_id ?? mid,
      name,
      email: p?.email ?? '—',
      initial: name.charAt(0).toUpperCase(),
      plan: plan?.name ?? '—',
      status,
      joined: l.joined_at ? fmtDate(l.joined_at) : '—',
      renews: isActive ? (remaining <= 7 ? `in ${remaining} day${remaining === 1 ? '' : 's'}` : fmtDate(sub!.end_date)) : '—',
      value: plan ? fmtNaira(Number(plan.price)) : '—',
    };
  });

  const KPIS = [
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: String(active), lbl: 'Active members' },
    { icon: Clock, fg: '#ffb020', bg: '#ffb0201f', val: String(expiring), lbl: 'Expiring this week' },
    { icon: UserX, fg: '#ff4560', bg: '#ff45601f', val: String(lapsed), lbl: 'Lapsed' },
    { icon: UserPlus, fg: '#4080ff', bg: '#4080ff1f', val: String(fresh), lbl: 'New this month' },
  ];

  return (
    <>
      <div className="page-h">
        <div><h1>Members</h1><p>{active} active · {expiring} expiring this week · {lapsed} lapsed</p></div>
        <div className="seg"><button className="on">All</button><button>Active</button><button>Expiring</button><button>Expired</button></div>
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
          <div className="search"><Search strokeWidth={1.75} /><input placeholder="Search by name or email…" aria-label="Search members" /></div>
          <div style={{ flex: 1 }} />
          <button className="gf-btn gf-btn-secondary gf-btn-sm"><Filter strokeWidth={1.9} size={15} /> Filters</button>
          <button className="gf-btn gf-btn-secondary gf-btn-sm"><Download strokeWidth={1.9} size={15} /> Export</button>
        </div>
        {rows.length === 0 ? (
          <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No members yet</h3><p>Members appear here after they sign up or are added.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Joined</th><th>Renews</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="who"><span className="gf-avatar gf-avatar-sm">{r.initial}</span><div><strong>{r.name}</strong><small>{r.email}</small></div></div></td>
                  <td>{r.plan}</td>
                  <td><span className={`gf-badge ${r.status[0]}`}>{r.status[1]}</span></td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{r.joined}</td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{r.renews}</td>
                  <td className="naira" style={{ textAlign: 'right' }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

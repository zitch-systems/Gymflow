import { Users, UserPlus, Activity, Building2, Search } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { Pagination } from '@/components/pagination';
import { sa } from '@/lib/superadmin-path';

export const metadata = { title: 'All members' };

const PAGE_SIZE = 50;

export default async function SuperMembers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // KPI counts are whole-platform (dedicated count queries), independent of the
  // paginated list below.
  const [{ count: total }, { count: gyms }, { count: fresh }] = await Promise.all([
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('gyms').select('id', { count: 'exact', head: true }),
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).gte('joined_at', monthAgo),
  ]);

  // Search resolves to member ids server-side (name/email), so it spans every
  // page rather than filtering a truncated window. No search → the newest links,
  // paginated. Either way we get an exact count for the pager.
  let matchIds: string[] | null = null;
  if (q) {
    const safe = q.replace(/[%,()*\\]/g, ' ').trim();
    const { data: hits } = await supabase
      .from('profiles').select('id').or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(1000);
    matchIds = (hits ?? []).map((h) => h.id);
  }

  const from = (page - 1) * PAGE_SIZE;
  let linkQuery = supabase
    .from('gym_member_links')
    .select('member_id, gym_id, joined_at, status', { count: 'exact' })
    .eq('is_active', true);
  if (matchIds) linkQuery = linkQuery.in('member_id', matchIds.length ? matchIds : ['00000000-0000-0000-0000-000000000000']);
  const { data: links, count: listCount } = await linkQuery
    .order('joined_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const memberIds = [...new Set((links ?? []).map((r) => r.member_id).filter(Boolean) as string[])];
  const gymIds = [...new Set((links ?? []).map((r) => r.gym_id).filter(Boolean) as string[])];
  const [{ data: profiles }, { data: gymRows }] = await Promise.all([
    memberIds.length ? supabase.from('profiles').select('id, full_name, email').in('id', memberIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    gymIds.length ? supabase.from('gyms').select('id, name').in('id', gymIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const pById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const gName = new Map((gymRows ?? []).map((g) => [g.id, g.name]));
  const recent = links ?? [];

  const KPIS = [
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: (total ?? 0).toLocaleString('en-NG'), lbl: 'Total members' },
    { icon: Building2, fg: '#4080ff', bg: '#4080ff1f', val: String(gyms ?? 0), lbl: 'Across gyms' },
    { icon: UserPlus, fg: '#a8d92e', bg: '#c6f24e1f', val: (fresh ?? 0).toLocaleString('en-NG'), lbl: 'New this month' },
    { icon: Activity, fg: '#ffb020', bg: '#ffb0201f', val: '—', lbl: 'Active monthly' },
  ];

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>All members</h1><p>{(total ?? 0).toLocaleString('en-NG')} members across {gyms ?? 0} gym{gyms === 1 ? '' : 's'} · {(fresh ?? 0).toLocaleString('en-NG')} new this month</p></div></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="panel-h"><div><h3>{q ? 'Search results' : 'Recent members'}</h3><div className="sub">{q ? 'Matching name or email across every gym' : 'Newest across every gym'}</div></div></div>
        <div className="toolbar"><form className="search" action={sa('/members')} style={{ display: 'flex' }}><Search strokeWidth={1.75} /><input name="q" defaultValue={q} placeholder="Search across every gym…" aria-label="Search members" /></form></div>
        {recent.length === 0 ? (
          q
            ? <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No matching members</h3><p>Try a different name or email.</p></div>
            : <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No members yet</h3><p>Members across all gyms appear here.</p></div>
        ) : (
          <>
            <div className="tbl-scroll">
              <table className="gt">
                <thead><tr><th>Member</th><th>Gym</th><th style={{ textAlign: 'right' }}>Status</th></tr></thead>
                <tbody>{recent.map((r, i) => {
                  const p = r.member_id ? pById.get(r.member_id) : null;
                  const nm = p?.full_name ?? p?.email ?? 'Member';
                  return (
                    <tr key={i}><td><div className="gname"><span className="sq" style={{ background: 'linear-gradient(135deg,#11d18b,#07a86c)' }}>{nm.charAt(0).toUpperCase()}</span><div><strong>{nm}</strong><small>{p?.email ?? '—'}</small></div></div></td><td style={{ color: 'var(--gf-text-secondary)' }}>{r.gym_id ? (gName.get(r.gym_id) ?? '—') : '—'}</td><td style={{ textAlign: 'right' }}><span className="gf-badge gf-badge-success">{r.status ?? 'Active'}</span></td></tr>
                  );
                })}</tbody>
              </table>
            </div>
            <Pagination basePath="/superadmin/members" params={{ q: q || undefined }} page={page} pageSize={PAGE_SIZE} total={listCount ?? 0} />
          </>
        )}
      </div>
    </>
  );
}

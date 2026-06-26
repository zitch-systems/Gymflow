import { Users, UserPlus, Activity, Building2, Search } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'All members' };

export default async function SuperMembers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const needle = q.toLowerCase();
  const supabase = await createClient();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ count: total }, { count: gyms }, { count: fresh }, { data: links }] = await Promise.all([
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('gyms').select('id', { count: 'exact', head: true }),
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).gte('joined_at', monthAgo),
    supabase.from('gym_member_links').select('member_id, gym_id, joined_at, status').eq('is_active', true).order('joined_at', { ascending: false }).limit(200),
  ]);

  const memberIds = [...new Set((links ?? []).map((r) => r.member_id).filter(Boolean) as string[])];
  const gymIds = [...new Set((links ?? []).map((r) => r.gym_id).filter(Boolean) as string[])];
  const [{ data: profiles }, { data: gymRows }] = await Promise.all([
    memberIds.length ? supabase.from('profiles').select('id, full_name, email').in('id', memberIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    gymIds.length ? supabase.from('gyms').select('id, name').in('id', gymIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const pById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const gName = new Map((gymRows ?? []).map((g) => [g.id, g.name]));

  const recent = (links ?? []).filter((r) => {
    if (!needle) return true;
    const p = r.member_id ? pById.get(r.member_id) : null;
    const gym = r.gym_id ? gName.get(r.gym_id) ?? '' : '';
    return `${p?.full_name ?? ''} ${p?.email ?? ''} ${gym}`.toLowerCase().includes(needle);
  });

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
        <div className="panel-h"><div><h3>Recent members</h3><div className="sub">Newest across every gym</div></div></div>
        <div className="toolbar"><form className="search" action="/superadmin/members" style={{ display: 'flex' }}><Search strokeWidth={1.75} /><input name="q" defaultValue={q} placeholder="Search across every gym…" aria-label="Search members" /></form></div>
        {recent.length === 0 ? (
          needle
            ? <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No matching members</h3><p>Try a different name, email or gym.</p></div>
            : <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No members yet</h3><p>Members across all gyms appear here.</p></div>
        ) : (
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
        )}
      </div>
    </>
  );
}

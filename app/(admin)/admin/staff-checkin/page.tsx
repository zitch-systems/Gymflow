import { ScanLine, Clock, TrendingUp, QrCode, Search } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Check-In' };

export default async function AdminCheckin() {
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { data: feed } = await supabase
    .from('check_ins')
    .select('id, checked_in_at, check_in_method, member_id')
    .eq('gym_id', gym.id)
    .order('checked_in_at', { ascending: false })
    .limit(12);

  const todayRows = (feed ?? []).filter((c) => c.checked_in_at && new Date(c.checked_in_at) >= dayStart);
  const lastTime = feed?.[0]?.checked_in_at
    ? new Date(feed[0].checked_in_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  const ids = [...new Set((feed ?? []).map((c) => c.member_id).filter(Boolean) as string[])];
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  return (
    <>
      <div className="page-h"><div><h1>Check-In</h1><p>{gym.name} · {todayRows.length} member{todayRows.length === 1 ? '' : 's'} in so far today</p></div></div>

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><ScanLine strokeWidth={1.9} /></div></div><div className="kpi-val">{todayRows.length}</div><div className="kpi-lbl">Check-ins today</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Clock strokeWidth={1.9} /></div></div><div className="kpi-val">{lastTime}</div><div className="kpi-lbl">Last check-in</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><TrendingUp strokeWidth={1.9} /></div></div><div className="kpi-val">{feed?.length ?? 0}</div><div className="kpi-lbl">Recent total</div></div>
      </section>

      <section className="ci-grid">
        <div className="scan">
          <div className="ring"><QrCode strokeWidth={1.75} /></div>
          <h2>Scan or search to check in</h2>
          <p>Members scan the door QR, or find them manually below.</p>
          <div className="find"><Search strokeWidth={1.75} /><input placeholder="Type a member name…" aria-label="Find member" /></div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Today&apos;s check-ins</h3><div className="sub"><span className="gf-status-dot active">Live</span></div></div></div>
          {(feed ?? []).length === 0 ? (
            <div className="empty"><div className="eic"><ScanLine strokeWidth={1.6} /></div><h3>No check-ins yet</h3><p>Members appear here as they arrive.</p></div>
          ) : (
            <div className="feed">
              {(feed ?? []).map((c) => {
                const nm = c.member_id ? (nameById.get(c.member_id) ?? 'Member') : 'Member';
                const t = c.checked_in_at ? new Date(c.checked_in_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                return (
                  <div className="feed-row" key={c.id}>
                    <span className="gf-avatar gf-avatar-sm">{nm.charAt(0).toUpperCase()}</span>
                    <span className="feed-meta"><strong>{nm}</strong><small>{c.check_in_method ?? 'QR'} · Main entrance</small></span>
                    <span className="feed-time">{t}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

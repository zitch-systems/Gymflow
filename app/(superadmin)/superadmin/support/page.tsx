import { LifeBuoy, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'Support' };

const STATUS: Record<string, [string, string]> = {
  open: ['gf-badge-warning', 'Open'], urgent: ['gf-badge-danger', 'Urgent'],
  waiting: ['gf-badge-neutral', 'Waiting'], resolved: ['gf-badge-success', 'Resolved'],
};

export default async function SuperSupport() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('id, subject, body, status, priority, gym_id, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  const all = tickets ?? [];
  const open = all.filter((t) => t.status !== 'resolved');
  const urgent = all.filter((t) => t.priority === 'urgent' && t.status !== 'resolved');

  const gymIds = [...new Set(all.map((t) => t.gym_id).filter(Boolean) as string[])];
  const { data: gyms } = gymIds.length ? await supabase.from('gyms').select('id, name').in('id', gymIds) : { data: [] as { id: string; name: string }[] };
  const gName = new Map((gyms ?? []).map((g) => [g.id, g.name]));

  const KPIS = [
    { icon: LifeBuoy, fg: '#11d18b', bg: '#11d18b1f', val: String(open.length), lbl: 'Open tickets' },
    { icon: AlertTriangle, fg: '#ff4560', bg: '#ff45601f', val: String(urgent.length), lbl: 'Urgent' },
    { icon: Clock, fg: '#4080ff', bg: '#4080ff1f', val: '—', lbl: 'Median first response' },
    { icon: CheckCircle2, fg: '#a8d92e', bg: '#c6f24e1f', val: String(all.filter((t) => t.status === 'resolved').length), lbl: 'Resolved' },
  ];

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Support</h1><p>{open.length} open ticket{open.length === 1 ? '' : 's'} · {urgent.length} urgent</p></div></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="panel-h"><div><h3>Tickets</h3><div className="sub">Across all gyms</div></div></div>
        {all.length === 0 ? (
          <div className="empty"><div className="eic"><LifeBuoy strokeWidth={1.6} /></div><h3>No tickets</h3><p>Support requests from gyms will appear here.</p></div>
        ) : all.map((t) => {
          const st = STATUS[t.status] ?? ['gf-badge-neutral', t.status];
          const nm = t.gym_id ? (gName.get(t.gym_id) ?? 'Gym') : 'Platform';
          return (
            <div className="act-row" key={t.id}>
              <span className="gf-avatar gf-avatar-sm">{nm.charAt(0).toUpperCase()}</span>
              <div className="m"><strong>{nm}</strong><small>{t.subject}</small></div>
              <span className={`gf-badge ${st[0]}`}>{st[1]}</span>
              <span className="t" style={{ marginLeft: 10 }}>{fmtDate(t.created_at)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

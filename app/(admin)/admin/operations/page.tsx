import { LayoutGrid, Dumbbell, Wrench, Receipt, AlertTriangle, Check, Plus } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';

export const metadata = { title: 'Facility' };

const EQ_STATUS: Record<string, [string, string]> = {
  operational: ['gf-badge-success', 'OK'], maintenance: ['gf-badge-warning', 'Service'], broken: ['gf-badge-danger', 'Down'],
};

export default async function AdminFacility() {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: equipment }, { data: expenses }] = await Promise.all([
    supabase.from('equipment').select('id, name, category, status, location, last_maintenance_date, next_maintenance_date, maintenance_notes').eq('gym_id', gym.id).order('name', { ascending: true }).limit(100),
    supabase.from('expenses').select('id, amount, category, description, expense_date').eq('gym_id', gym.id).order('expense_date', { ascending: false }).limit(20),
  ]);

  const eq = equipment ?? [];
  const zones = new Set(eq.map((e) => e.location).filter(Boolean)).size;
  const needsService = eq.filter((e) => e.status === 'maintenance' || e.status === 'broken' || (e.next_maintenance_date && e.next_maintenance_date <= todayIso));
  const spend30 = (expenses ?? []).filter((e) => (e.expense_date ?? '') >= monthAgo).reduce((s, e) => s + Number(e.amount ?? 0), 0);

  const KPIS = [
    { icon: LayoutGrid, fg: '#11d18b', bg: '#11d18b1f', val: String(zones), lbl: 'Zones' },
    { icon: Dumbbell, fg: '#4080ff', bg: '#4080ff1f', val: String(eq.length), lbl: 'Equipment units' },
    { icon: Wrench, fg: '#ffb020', bg: '#ffb0201f', val: String(needsService.length), lbl: 'Need maintenance' },
    { icon: Receipt, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(spend30), lbl: 'Spend (30d)' },
  ];

  return (
    <>
      <div className="page-h"><div><h1>Facility</h1><p>{gym.name} · {zones} zone{zones === 1 ? '' : 's'} · {eq.length} equipment unit{eq.length === 1 ? '' : 's'}</p></div></div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <div className="grid2" style={{ gridTemplateColumns: '1fr 340px' }}>
        <div className="panel">
          <div className="panel-h"><div><h3>Equipment</h3><div className="sub">{eq.length} unit{eq.length === 1 ? '' : 's'} · {needsService.length} flagged</div></div></div>
          {eq.length === 0 ? (
            <div className="empty"><div className="eic"><Dumbbell strokeWidth={1.6} /></div><h3>No equipment logged</h3><p>Add equipment to track maintenance and zones.</p></div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Equipment</th><th>Zone</th><th>Last serviced</th><th>Status</th></tr></thead>
              <tbody>
                {eq.map((e) => {
                  const st = EQ_STATUS[e.status ?? 'operational'] ?? ['gf-badge-neutral', e.status ?? '—'];
                  return (
                    <tr key={e.id}>
                      <td><div className="eq-name"><div className="ic"><Dumbbell strokeWidth={1.9} /></div><div><strong>{e.name}</strong><small>{e.category ?? '—'}</small></div></div></td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{e.location ?? '—'}</td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{e.last_maintenance_date ? fmtDate(e.last_maintenance_date) : '—'}</td>
                      <td><span className={`gf-badge ${st[0]}`}>{st[1]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Maintenance</h3><div className="sub">Flagged units</div></div></div>
            {needsService.length === 0 ? (
              <div className="mt"><div className="ic" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)' }}><Check strokeWidth={1.9} /></div><div className="m"><strong>All good</strong><small>Nothing needs service</small></div></div>
            ) : needsService.slice(0, 6).map((e) => (
              <div className="mt" key={e.id}>
                <div className="ic" style={{ background: e.status === 'broken' ? 'var(--gf-danger-soft)' : 'var(--gf-warning-soft)', color: e.status === 'broken' ? 'var(--gf-danger)' : 'var(--gf-warning)' }}><AlertTriangle strokeWidth={1.9} /></div>
                <div className="m"><strong>{e.name}</strong><small>{e.location ?? e.category ?? '—'}{e.maintenance_notes ? ` · ${e.maintenance_notes}` : ''}</small></div>
                <span className="t">{e.next_maintenance_date ? fmtDate(e.next_maintenance_date) : ''}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>Recent expenses</h3><div className="sub">{fmtNaira(spend30)} last 30 days</div></div><span className="link"><Plus strokeWidth={2} size={14} /> Log</span></div>
            {(expenses ?? []).length === 0 ? (
              <div className="sub">No expenses logged.</div>
            ) : (expenses ?? []).slice(0, 6).map((x) => (
              <div className="mt" key={x.id}>
                <div className="ic" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><Receipt strokeWidth={1.9} /></div>
                <div className="m"><strong>{x.description ?? x.category}</strong><small>{x.expense_date ? fmtDate(x.expense_date) : ''}</small></div>
                <span className="t naira">{fmtNaira(Number(x.amount ?? 0))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import { LayoutGrid, Dumbbell, Wrench, Receipt, AlertTriangle, Check, Plus, Pencil } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { ExpenseForm } from '@/components/admin/expense-form';

export const metadata = { title: 'Facility' };

const EQ_STATUS: Record<string, [string, string]> = {
  active: ['gf-badge-success', 'OK'], maintenance: ['gf-badge-warning', 'Service'],
  retired: ['gf-badge-danger', 'Down'], lost: ['gf-badge-danger', 'Lost'],
};

export default async function AdminFacility() {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: equipment }, { data: expenses }] = await Promise.all([
    supabase.from('equipment').select('id, name, category, status, location, last_maintenance_date, next_maintenance_date, maintenance_notes, photo_url').eq('gym_id', gym.id).order('name', { ascending: true }).limit(100),
    supabase.from('expenses').select('id, amount, category, description, expense_date').eq('gym_id', gym.id).order('expense_date', { ascending: false }).limit(20),
  ]);

  const eq = equipment ?? [];
  const zones = new Set(eq.map((e) => e.location).filter(Boolean)).size;
  const needsService = eq.filter((e) => e.status === 'maintenance' || e.status === 'retired' || e.status === 'lost' || (e.next_maintenance_date && e.next_maintenance_date <= todayIso));
  const spend30 = (expenses ?? []).filter((e) => (e.expense_date ?? '') >= monthAgo).reduce((s, e) => s + Number(e.amount ?? 0), 0);

  const KPIS = [
    { icon: LayoutGrid, fg: '#11d18b', bg: '#11d18b1f', val: String(zones), lbl: 'Zones' },
    { icon: Dumbbell, fg: '#4080ff', bg: '#4080ff1f', val: String(eq.length), lbl: 'Equipment units' },
    { icon: Wrench, fg: '#ffb020', bg: '#ffb0201f', val: String(needsService.length), lbl: 'Need maintenance' },
    { icon: Receipt, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(spend30), lbl: 'Spend (30d)' },
  ];

  return (
    <>
      <div className="page-h">
        <div><h1>Facility</h1><p>{gym.name} · {zones} zone{zones === 1 ? '' : 's'} · {eq.length} equipment unit{eq.length === 1 ? '' : 's'}</p></div>
        <Link href="/admin/operations/equipment/new" className="gf-btn gf-btn-primary" style={{ textDecoration: 'none' }}><Plus strokeWidth={2} size={16} /> Add equipment</Link>
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <div className="grid2" style={{ gridTemplateColumns: '1fr 340px' }}>
        <div className="panel">
          <div className="panel-h"><div><h3>Equipment</h3><div className="sub">{eq.length} unit{eq.length === 1 ? '' : 's'} · {needsService.length} flagged</div></div><Link href="/admin/operations/equipment/new" className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus strokeWidth={2} size={14} /> Add</Link></div>
          {eq.length === 0 ? (
            <div className="empty"><div className="eic"><Dumbbell strokeWidth={1.6} /></div><h3>No equipment logged</h3><p>Add equipment to track maintenance and zones.</p><Link href="/admin/operations/equipment/new" className="gf-btn gf-btn-primary gf-btn-sm" style={{ textDecoration: 'none', marginTop: 12 }}><Plus strokeWidth={2} size={15} /> Add equipment</Link></div>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead><tr><th>Equipment</th><th>Zone</th><th>Last serviced</th><th>Status</th></tr></thead>
                <tbody>
                  {eq.map((e) => {
                    const st = EQ_STATUS[e.status ?? 'active'] ?? ['gf-badge-neutral', e.status ?? '—'];
                    return (
                      <tr key={e.id}>
                        <td><div className="eq-name"><div className="ic" style={e.photo_url ? { overflow: 'hidden' } : undefined}>{e.photo_url ? (
                          // .eq-name .ic is a fixed 34×34 box.
                          <Image src={e.photo_url} alt="" width={34} height={34} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : <Dumbbell strokeWidth={1.9} />}</div><div><strong><Link href={`/admin/operations/equipment/${e.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{e.name}</Link></strong><small>{e.category ?? '—'}</small></div></div></td>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>{e.location ?? '—'}</td>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>{e.last_maintenance_date ? fmtDate(e.last_maintenance_date) : '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span className={`gf-badge ${st[0]}`}>{st[1]}</span>
                            <Link href={`/admin/operations/equipment/${e.id}`} className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Edit equipment"><Pencil strokeWidth={1.9} size={14} /></Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Maintenance</h3><div className="sub">Flagged units</div></div></div>
            {needsService.length === 0 ? (
              <div className="mt"><div className="ic" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)' }}><Check strokeWidth={1.9} /></div><div className="m"><strong>All good</strong><small>Nothing needs service</small></div></div>
            ) : needsService.slice(0, 6).map((e) => (
              <div className="mt" key={e.id}>
                <div className="ic" style={{ background: e.status === 'retired' || e.status === 'lost' ? 'var(--gf-danger-soft)' : 'var(--gf-warning-soft)', color: e.status === 'retired' || e.status === 'lost' ? 'var(--gf-danger)' : 'var(--gf-warning)' }}><AlertTriangle strokeWidth={1.9} /></div>
                <div className="m"><strong>{e.name}</strong><small>{e.location ?? e.category ?? '—'}{e.maintenance_notes ? ` · ${e.maintenance_notes}` : ''}</small></div>
                <span className="t">{e.next_maintenance_date ? fmtDate(e.next_maintenance_date) : ''}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>Recent expenses</h3><div className="sub">{fmtNaira(spend30)} last 30 days</div></div><ExpenseForm /></div>
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

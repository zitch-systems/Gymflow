import { LayoutGrid, Dumbbell, Wrench, Activity, Bike, Users, Waves, AlertTriangle, Droplet, Check, Plus } from 'lucide-react';

export const metadata = { title: 'Facility' };

const ZONES = [
  { icon: Dumbbell, name: 'Weights floor', cap: 60, inNow: 43, pct: 72, color: 'var(--gf-warning)' },
  { icon: Bike, name: 'Cardio zone', cap: 40, inNow: 22, pct: 55, color: 'var(--gf-brand)' },
  { icon: Users, name: 'Studio A', cap: 24, inNow: 22, pct: 92, color: 'var(--gf-danger)' },
  { icon: Waves, name: 'Studio B / Yoga', cap: 16, inNow: 5, pct: 31, color: 'var(--gf-brand)' },
];

const MAINT = [
  { icon: AlertTriangle, fg: 'var(--gf-danger)', bg: 'var(--gf-danger-soft)', title: 'Treadmill #4 — belt slipping', sub: 'Cardio zone · reported by Femi', t: '2h' },
  { icon: Wrench, fg: 'var(--gf-warning)', bg: 'var(--gf-warning-soft)', title: 'Cable machine — frayed cable', sub: 'Weights floor · scheduled', t: '1d' },
  { icon: Droplet, fg: 'var(--gf-warning)', bg: 'var(--gf-warning-soft)', title: 'Shower 2 — low pressure', sub: 'Locker room · vendor booked', t: '2d' },
  { icon: Check, fg: 'var(--gf-success)', bg: 'var(--gf-success-soft)', title: 'AC unit — serviced', sub: 'Studio A · completed', t: '3d' },
];

const EQUIP = [
  { name: 'Treadmills', zone: 'Cardio zone', units: 12, serviced: '2 weeks ago', st: ['gf-badge-warning', '1 down'] },
  { name: 'Power racks', zone: 'Weights floor', units: 8, serviced: '1 month ago', st: ['gf-badge-success', 'OK'] },
  { name: 'Spin bikes', zone: 'Studio 2', units: 24, serviced: '3 weeks ago', st: ['gf-badge-success', 'OK'] },
  { name: 'Cable machines', zone: 'Weights floor', units: 6, serviced: '6 weeks ago', st: ['gf-badge-warning', 'Service due'] },
];

export default function AdminFacility() {
  return (
    <>
      <div className="page-h"><div><h1>Facility</h1><p>Powerhouse Fitness · Lekki · 1,240 m² · 4 zones · 86 equipment units</p></div></div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><LayoutGrid strokeWidth={1.9} /></div></div><div className="kpi-val">4</div><div className="kpi-lbl">Active zones</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Dumbbell strokeWidth={1.9} /></div></div><div className="kpi-val">86</div><div className="kpi-lbl">Equipment units</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ffb0201f', color: '#ffb020' }}><Wrench strokeWidth={1.9} /></div></div><div className="kpi-val">3</div><div className="kpi-lbl">Need maintenance</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Activity strokeWidth={1.9} /></div></div><div className="kpi-val">68%</div><div className="kpi-lbl">Current occupancy</div></div>
      </section>

      <div className="grid2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Zones &amp; capacity</h3><div className="sub">Live occupancy across the floor</div></div></div>
            <div className="zones">
              {ZONES.map((z) => {
                const Icon = z.icon;
                return (
                  <div className="zone" key={z.name}>
                    <div className="zt"><div className="ic"><Icon strokeWidth={1.9} /></div><div><strong>{z.name}</strong><small>Cap {z.cap}</small></div></div>
                    <div className="cap-bar"><div style={{ width: `${z.pct}%`, background: z.color }} /></div>
                    <div className="cap-meta"><span>{z.inNow} in now</span><span>{z.pct}%</span></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Equipment</h3><div className="sub">86 units · 3 flagged</div></div>
              <div style={{ display: 'flex', gap: 8 }}><span className="gf-chip active">All</span><span className="gf-chip">Operational</span><span className="gf-chip">Needs service</span></div>
            </div>
            <table className="tbl">
              <thead><tr><th>Equipment</th><th>Zone</th><th>Units</th><th>Last serviced</th><th>Status</th></tr></thead>
              <tbody>
                {EQUIP.map((e) => (
                  <tr key={e.name}>
                    <td><div className="eq-name"><div className="ic"><Dumbbell strokeWidth={1.9} /></div><div><strong>{e.name}</strong></div></div></td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{e.zone}</td>
                    <td>{e.units}</td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{e.serviced}</td>
                    <td><span className={`gf-badge ${e.st[0]}`}>{e.st[1]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h"><div><h3>Maintenance</h3><div className="sub">Open tickets</div></div><span className="link"><Plus strokeWidth={2} size={14} /> Log issue</span></div>
            {MAINT.map((m, i) => {
              const Icon = m.icon;
              return (
                <div className="mt" key={i}>
                  <div className="ic" style={{ background: m.bg, color: m.fg }}><Icon strokeWidth={1.9} /></div>
                  <div className="m"><strong>{m.title}</strong><small>{m.sub}</small></div>
                  <span className="t">{m.t}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

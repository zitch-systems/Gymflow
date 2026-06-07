import { Dumbbell, CalendarCheck, AlertTriangle, Banknote } from 'lucide-react';
export const metadata = { title: 'PT clients · Instructor' };
const KPIS = [
  { icon: Dumbbell, fg: '#11d18b', bg: '#11d18b1f', val: '5', lbl: 'Active packs' },
  { icon: CalendarCheck, fg: '#4080ff', bg: '#4080ff1f', val: '38', lbl: 'Sessions this month' },
  { icon: AlertTriangle, fg: '#ffb020', bg: '#ffb0201f', val: '1', lbl: 'Pack expiring' },
  { icon: Banknote, fg: '#a8d92e', bg: '#c6f24e1f', val: '₦456K', lbl: 'PT revenue (mo)' },
];
const CLIENTS = [
  { i: 'CO', name: 'Chidi Okeke', sub: 'Pack 4 of 10 · next Tue 13:00' },
  { i: 'GU', name: 'Grace Udeh', sub: 'Pack 7 of 12 · next Wed 08:00' },
  { i: 'MA', name: 'Musa Abdul', sub: 'Pack 1 of 8 · next Thu 17:00' },
  { i: 'BA', name: 'Bola Ade', sub: 'Pack 9 of 10 · expiring soon' },
  { i: 'TI', name: 'Tina Idris', sub: 'Pack 3 of 8 · next Fri 09:00' },
];
export default function CoachClients() {
  return (
    <>
      <div className="hdr"><h1>PT clients</h1><p>5 active packs · 1 expiring · ₦12K avg session</p></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="panel">
        <div className="panel-h"><div><h3>Clients</h3><div className="sub">Pack progress &amp; next session</div></div></div>
        {CLIENTS.map((c) => (
          <div className="cl-row" key={c.name}><span className="gf-avatar gf-avatar-sm">{c.i}</span><div className="m"><strong>{c.name}</strong><small>{c.sub}</small></div><button className="gf-btn gf-btn-sm gf-btn-secondary">Log session</button></div>
        ))}
      </div>
    </>
  );
}

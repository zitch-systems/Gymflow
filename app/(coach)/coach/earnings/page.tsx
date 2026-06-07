import { Wallet, CalendarCheck, TrendingUp, Hourglass } from 'lucide-react';
export const metadata = { title: 'Earnings · Instructor' };
const KPIS = [
  { icon: Wallet, fg: '#11d18b', bg: '#11d18b1f', val: '₦168K', lbl: 'This month' },
  { icon: CalendarCheck, fg: '#4080ff', bg: '#4080ff1f', val: '42', lbl: 'Sessions paid' },
  { icon: TrendingUp, fg: '#a8d92e', bg: '#c6f24e1f', val: '+9%', lbl: 'vs last month' },
  { icon: Hourglass, fg: '#ffb020', bg: '#ffb0201f', val: '₦42K', lbl: 'Pending payout' },
];
const EC = [50, 64, 58, 78, 70, 92];
const BRK = [['Group classes', '₦96,000', 57], ['PT sessions', '₦54,000', 32], ['Workshops', '₦18,000', 11]];
export default function CoachEarnings() {
  return (
    <>
      <div className="hdr"><h1>Earnings</h1><p>May · ₦168,000 earned · next payout 2 Jun</p></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <div className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Earnings trend</h3><div className="sub">Last 6 weeks</div></div></div>
          <div className="ec">{EC.map((h, i) => <div className="col" key={i}><div className="bar" style={{ height: `${h}%` }} /><div className="lbl">W{i + 1}</div></div>)}</div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Breakdown</h3><div className="sub">By source · May</div></div></div>
          {BRK.map(([label, amt, pct]) => (
            <div key={label as string} style={{ padding: '12px 0', borderTop: '1px solid var(--gf-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><span style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 600, fontSize: '0.88rem' }}>{label}</span><span className="naira">{amt}</span></div>
              <div className="capbar" style={{ height: 7, background: 'var(--gf-elevated)', borderRadius: 99, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,var(--gf-brand-light),var(--gf-brand))' }} /></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

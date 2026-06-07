import { Repeat, Banknote, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
export const metadata = { title: 'Revenue' };
const KPIS = [
  { icon: Repeat, fg: '#11d18b', bg: '#11d18b1f', val: '₦18.7M', lbl: 'MRR', delta: '+12%', up: true },
  { icon: Wallet, fg: '#a8d92e', bg: '#c6f24e1f', val: '₦96.4M', lbl: 'Processed (May)', delta: '+18%', up: true },
  { icon: Banknote, fg: '#4080ff', bg: '#4080ff1f', val: '₦2.9M', lbl: 'Platform fees', delta: '+11%', up: true },
  { icon: TrendingDown, fg: '#ff4560', bg: '#ff45601f', val: '2.1%', lbl: 'Revenue churn', delta: '0.4%', up: false },
];
const BARS = [52, 58, 61, 66, 70, 74, 79, 83, 88, 91, 96, 100];
const MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];
const MIX = [['Scale', 44, '#11d18b'], ['Growth', 38, '#4080ff'], ['Starter', 18, '#c6f24e']] as const;
export default function SuperRevenue() {
  const donut = `conic-gradient(#11d18b 0 44%, #4080ff 44% 82%, #c6f24e 82% 100%)`;
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Platform</span><h1>Revenue</h1><p>₦18.7M MRR · +12% MoM · ₦96.4M processed in May · 2.1% churn</p></div></div>
      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div><span className={`delta ${k.up ? 'up' : 'down'}`}>{k.up ? <TrendingUp strokeWidth={2} /> : <TrendingDown strokeWidth={2} />}{k.delta}</span></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>
      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>MRR growth</h3><div className="sub">Trailing 12 months</div></div></div>
          <div className="bars" style={{ height: 200 }}>{BARS.map((h, i) => <div className="bcol" key={i}><div className="bar" style={{ height: `${h}%` }} data-v={`${h}`} /><div className="blbl">{MONTHS[i]}</div></div>)}</div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Revenue by plan</h3><div className="sub">Share of MRR</div></div></div>
          <div className="donut" style={{ background: donut, borderRadius: '50%', position: 'relative' }}><div style={{ position: 'absolute', inset: '26%', borderRadius: '50%', background: 'var(--gf-surface)' }} /></div>
          <div className="legend">{MIX.map(([l, p, c]) => <div className="lg-row" key={l}><span className="lg-dot" style={{ background: c }} /><span className="nm">{l}</span><span className="vl">{p}%</span></div>)}</div>
        </div>
      </section>
    </>
  );
}

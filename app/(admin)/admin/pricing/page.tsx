import { Repeat, Users, CreditCard, TrendingUp, Pencil, Copy, Check, PlusCircle } from 'lucide-react';

export const metadata = { title: 'Pricing & plans' };

const PLANS = [
  { name: 'Monthly', amt: '₦13,999', per: '/mo', desc: 'Flexible month-to-month access', members: '251', mrr: '₦3.5M', feats: ['Full gym access', 'Class booking', 'Auto-renew'], pop: false },
  { name: 'Quarterly', amt: '₦37,999', per: '/qtr', desc: 'Save 10% · billed every 3 months', members: '144', mrr: '₦1.8M', feats: ['Everything in Monthly', '1 guest pass / month', 'Priority class booking'], pop: true },
  { name: 'Annual', amt: '₦119,999', per: '/yr', desc: 'Best value · save 28% vs monthly', members: '87', mrr: '₦0.9M', feats: ['Everything in Quarterly', 'Free InBody scan', '2 PT sessions'], pop: false },
];

export default function AdminPricing() {
  return (
    <>
      <div className="page-h">
        <div><h1>Pricing &amp; plans</h1><p>3 active plans · ₦5.8M monthly recurring · auto-renew on</p></div>
      </div>

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Repeat strokeWidth={1.9} /></div><span className="delta up"><TrendingUp strokeWidth={2} />+11%</span></div><div className="kpi-val">₦5.8M</div><div className="kpi-lbl">Monthly recurring</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><Users strokeWidth={1.9} /></div></div><div className="kpi-val">482</div><div className="kpi-lbl">On a paid plan</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><CreditCard strokeWidth={1.9} /></div></div><div className="kpi-val">₦12,034</div><div className="kpi-lbl">Avg revenue / member</div></div>
      </section>

      <div className="plans">
        {PLANS.map((p) => (
          <div className={`plan${p.pop ? ' pop' : ''}`} key={p.name}>
            <div className="plan-top">
              <span className="nm">{p.name}{p.pop && <span className="gf-badge gf-badge-brand" style={{ marginLeft: 6 }}>Popular</span>}</span>
              <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Edit plan"><Pencil strokeWidth={1.9} /></button>
            </div>
            <div className="amt">{p.amt}<small>{p.per}</small></div>
            <div className="desc">{p.desc}</div>
            <div className="stat">
              <div><div className="v">{p.members}</div><div className="l">Members</div></div>
              <div><div className="v">{p.mrr}</div><div className="l">MRR</div></div>
            </div>
            <ul>{p.feats.map((f) => <li key={f}><Check strokeWidth={2.2} /> {f}</li>)}</ul>
            <div className="acts">
              <button className={`gf-btn gf-btn-${p.pop ? 'primary' : 'secondary'} gf-btn-sm gf-btn-full`}>Edit</button>
              <button className="gf-btn gf-btn-ghost gf-btn-sm" aria-label="Duplicate"><Copy strokeWidth={1.9} size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      <button className="addplan"><div className="in"><PlusCircle strokeWidth={1.6} /><div style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 600, marginTop: 8 }}>Add a new plan</div></div></button>
    </>
  );
}

import { Clock, MessageCircle, Reply, Zap, Send, Mail, Check } from 'lucide-react';

export const metadata = { title: 'Reminders' };

const EXPIRING = [
  { i: 'N', name: 'Ngozi Eze', sub: 'Monthly · expires in 3 days' },
  { i: 'F', name: 'Fatima Yusuf', sub: 'Monthly · expires in 5 days' },
  { i: 'D', name: 'David Okon', sub: 'Quarterly · expires in 6 days' },
  { i: 'S', name: 'Sade Koya', sub: 'Monthly · expires in 6 days' },
];

const LOG = [
  { icon: MessageCircle, fg: 'var(--gf-brand)', bg: 'var(--gf-brand-soft)', title: 'WhatsApp delivered', sub: 'Bola Ade · expiry nudge', t: '12m' },
  { icon: Mail, fg: 'var(--gf-info)', bg: 'var(--gf-info-soft)', title: 'Email opened', sub: 'Chidi Okeke · receipt', t: '1h' },
  { icon: MessageCircle, fg: 'var(--gf-brand)', bg: 'var(--gf-brand-soft)', title: 'WhatsApp delivered', sub: 'Grace Udo · class reminder', t: '2h' },
  { icon: Reply, fg: 'var(--gf-success)', bg: 'var(--gf-success-soft)', title: 'Renewed after nudge', sub: 'Musa Ibrahim · Monthly', t: '3h' },
];

export default function AdminReminders() {
  return (
    <>
      <div className="page-h">
        <div><h1>Reminders</h1><p>18 memberships expiring this week · 142 reminders sent this month</p></div>
        <button className="gf-btn gf-btn-primary"><Send strokeWidth={1.9} size={16} /> Send all due</button>
      </div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ffb0201f', color: '#ffb020' }}><Clock strokeWidth={1.9} /></div></div><div className="kpi-val">18</div><div className="kpi-lbl">Expiring this week</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><MessageCircle strokeWidth={1.9} /></div></div><div className="kpi-val">142</div><div className="kpi-lbl">Sent this month</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Reply strokeWidth={1.9} /></div></div><div className="kpi-val">61%</div><div className="kpi-lbl">Renewed after nudge</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Zap strokeWidth={1.9} /></div></div><div className="kpi-val">On</div><div className="kpi-lbl">Auto-reminders</div></div>
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Expiring this week</h3><div className="sub">Nudge before they lapse</div></div></div>
          {EXPIRING.map((m) => (
            <div className="rm" key={m.name}>
              <span className="gf-avatar gf-avatar-sm">{m.i}</span>
              <div className="m"><strong>{m.name}</strong><small>{m.sub}</small></div>
              <button className="gf-btn gf-btn-sm gf-btn-primary">Remind</button>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Recent reminders</h3><div className="sub">Delivery log</div></div></div>
          {LOG.map((l, i) => {
            const Icon = l.icon;
            return (
              <div className="log" key={i}>
                <div className="ic" style={{ background: l.bg, color: l.fg }}><Icon strokeWidth={1.9} /></div>
                <div className="m"><strong>{l.title}</strong><small>{l.sub}</small></div>
                <span className="t">{l.t}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

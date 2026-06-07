import { Building2, Banknote, AlertTriangle, ArrowUpCircle, ShieldCheck, Search } from 'lucide-react';
export const metadata = { title: 'Audit log' };
const LOG = [
  { icon: ShieldCheck, fg: 'var(--gf-info)', bg: 'var(--gf-info-soft)', title: 'Superadmin signed in', sub: 'platform@gymflow.ng · IP 102.89.x.x', t: 'Just now' },
  { icon: Building2, fg: 'var(--gf-brand)', bg: 'var(--gf-brand-soft)', title: 'Gym provisioned', sub: 'FlexZone Yaba · by platform@gymflow.ng', t: '8m ago' },
  { icon: ArrowUpCircle, fg: 'var(--gf-info)', bg: 'var(--gf-info-soft)', title: 'Plan changed', sub: 'Powerhouse · Growth → Scale', t: '3h ago' },
  { icon: Banknote, fg: 'var(--gf-success)', bg: 'var(--gf-success-soft)', title: 'Refund issued', sub: 'IronWorks · ₦37,999 · by support', t: '5h ago' },
  { icon: AlertTriangle, fg: 'var(--gf-warning)', bg: 'var(--gf-warning-soft)', title: 'Failed login throttled', sub: 'fithub admin · 5 attempts', t: 'Yesterday' },
];
export default function SuperAudit() {
  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Audit log</h1><p>Every privileged action across the platform</p></div></div>
      <div className="panel">
        <div className="toolbar"><div className="search"><Search strokeWidth={1.75} /><input placeholder="Filter by gym, actor or action…" aria-label="Search audit log" /></div><div style={{ flex: 1 }} /><span className="gf-chip active">All</span><span className="gf-chip">Auth</span><span className="gf-chip">Billing</span><span className="gf-chip">Tenant</span></div>
        {LOG.map((l, i) => { const Icon = l.icon; return (
          <div className="act-row" key={i}><div className="ic" style={{ background: l.bg, color: l.fg }}><Icon strokeWidth={1.9} /></div><div className="m"><strong>{l.title}</strong><small>{l.sub}</small></div><span className="t">{l.t}</span></div>
        ); })}
      </div>
    </>
  );
}

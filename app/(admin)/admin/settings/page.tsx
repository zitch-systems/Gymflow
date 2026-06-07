'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Building2, Palette, Clock, Bell, Plug, Users, Upload, CreditCard, MessageCircle, Mail } from 'lucide-react';

const NAV = [
  { id: 'profile', label: 'Gym profile', icon: Building2 },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'hours', label: 'Business hours', icon: Clock },
  { id: 'notif', label: 'Notifications', icon: Bell },
  { id: 'integ', label: 'Integrations', icon: Plug },
  { id: 'team', label: 'Team', icon: Users },
] as const;

const HOURS = [
  ['Monday – Friday', '05:00 — 22:00'], ['Saturday', '07:00 — 20:00'], ['Sunday', '08:00 — 18:00'],
];

const INTEG = [
  { icon: CreditCard, name: 'Paystack', sub: 'Subscriptions & auto-debit', st: ['gf-badge-success', 'Connected'] },
  { icon: MessageCircle, name: 'WhatsApp (Termii)', sub: 'Reminder & receipt delivery', st: ['gf-badge-success', 'Connected'] },
  { icon: Mail, name: 'Email (Resend)', sub: 'Transactional email', st: ['gf-badge-success', 'Connected'] },
];

export default function AdminSettings() {
  const [sec, setSec] = useState<string>('profile');

  return (
    <>
      <div className="page-h"><div><h1>Settings</h1><p>Powerhouse Fitness · manage your gym, branding and integrations</p></div></div>

      <div className="set-wrap">
        <nav className="subnav">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <a key={n.id} className={sec === n.id ? 'on' : undefined} onClick={() => setSec(n.id)} role="button" tabIndex={0}>
                <Icon strokeWidth={1.75} /> {n.label}
              </a>
            );
          })}
        </nav>

        <div>
          {sec === 'profile' && (
            <section className="sec on">
              <div className="panel">
                <div className="panel-title">Gym profile</div>
                <div className="panel-desc">Public details shown to members on your subdomain.</div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Gym name</label><input className="gf-input" defaultValue="Powerhouse Fitness" /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Subdomain</label><input className="gf-input" defaultValue="powerhouse.gymflow.ng" /></div>
                </div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Phone</label><input className="gf-input" defaultValue="0816 693 8327" /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Email</label><input className="gf-input" defaultValue="hello@powerhouse.ng" /></div>
                </div>
                <div className="gf-form-group" style={{ marginBottom: 18 }}><label className="gf-form-label">Address</label><input className="gf-input" defaultValue="41 Ogudu Road, Lagos" /></div>
                <button className="gf-btn gf-btn-primary">Save changes</button>
              </div>
            </section>
          )}

          {sec === 'branding' && (
            <section className="sec on">
              <div className="panel">
                <div className="panel-title">Branding</div>
                <div className="panel-desc">Your logo and accent colour appear across the member app.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                  <Image src="/images/logomark-v2.svg" alt="" width={56} height={56} />
                  <button className="gf-btn gf-btn-secondary gf-btn-sm"><Upload strokeWidth={1.9} size={15} /> Replace logo</button>
                </div>
                <label className="gf-form-label" style={{ display: 'block', marginBottom: 10 }}>Accent colour</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {['#11d18b', '#4080ff', '#ff4560', '#c6f24e', '#b67bf3'].map((c, i) => (
                    <span key={c} style={{ width: 36, height: 36, borderRadius: 10, background: c, outline: i === 0 ? '2px solid var(--gf-brand)' : undefined, outlineOffset: 2, cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {sec === 'hours' && (
            <section className="sec on">
              <div className="panel">
                <div className="panel-title">Business hours</div>
                <div className="panel-desc">When members can check in and book.</div>
                <div className="hours">
                  {HOURS.map(([d, t]) => (
                    <div className="hrow" key={d}><div className="dn">{d}</div><div className="tt">{t}</div></div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {sec === 'notif' && (
            <section className="sec on">
              <div className="panel">
                <div className="panel-title">Notifications</div>
                <div className="panel-desc">Automated reminders sent to members.</div>
                <div className="set-row"><div className="m"><strong>Class reminders</strong><small>WhatsApp + push, 1 hour before</small></div><span className="gf-badge gf-badge-success">On</span></div>
                <div className="set-row"><div className="m"><strong>Renewal nudges</strong><small>Email + WhatsApp before expiry</small></div><span className="gf-badge gf-badge-success">On</span></div>
                <div className="set-row"><div className="m"><strong>Payment receipts</strong><small>Emailed on every charge</small></div><span className="gf-badge gf-badge-success">On</span></div>
              </div>
            </section>
          )}

          {sec === 'integ' && (
            <section className="sec on">
              <div className="panel">
                <div className="panel-title">Integrations</div>
                <div className="panel-desc">Connected services powering payments and messaging.</div>
                {INTEG.map((it) => {
                  const Icon = it.icon;
                  return (
                    <div className="integ" key={it.name}>
                      <div className="ig" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Icon strokeWidth={1.75} /></div>
                      <div className="m"><strong>{it.name}</strong><small>{it.sub}</small></div>
                      <span className={`gf-badge ${it.st[0]}`}><span className="gf-dot" />{it.st[1]}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {sec === 'team' && (
            <section className="sec on">
              <div className="panel">
                <div className="panel-title">Team</div>
                <div className="panel-desc">Staff with admin or instructor access.</div>
                <div className="set-row"><div className="m"><strong>9 active staff members</strong><small>Manage roles on the Staff page</small></div><button className="gf-btn gf-btn-secondary gf-btn-sm">Invite</button></div>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

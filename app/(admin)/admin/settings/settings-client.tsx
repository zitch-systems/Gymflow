'use client';

import { useState, useActionState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Building2, Palette, Clock, Bell, Plug, Users, CreditCard, MessageCircle, Mail, Banknote } from 'lucide-react';
import { updateGym, updateBranding, uploadLogo, savePayout, type GymSaveState } from '@/lib/actions/gym';

const GYM_INIT: GymSaveState = { ok: false, error: null };
const SWATCHES = ['#11d18b', '#4080ff', '#ff4560', '#c6f24e', '#b67bf3', '#f59e0b', '#06b6d4'];

const NAV = [
  { id: 'profile', label: 'Gym profile', icon: Building2 },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'hours', label: 'Business hours', icon: Clock },
  { id: 'payouts', label: 'Payouts', icon: Banknote },
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

export type GymProfile = {
  name: string; slug: string; phone: string | null; email: string | null; address: string | null; brand_color: string | null; logo_url: string | null;
  bank_name: string | null; bank_code: string | null; account_number: string | null; account_name: string | null;
  payouts_connected: boolean; commission_pct: number;
};

export function SettingsClient({ gym, staffCount }: { gym: GymProfile; staffCount: number }) {
  const [sec, setSec] = useState<string>('profile');
  const [gymState, gymAction, gymPending] = useActionState(updateGym, GYM_INIT);
  const [brandState, brandAction, brandPending] = useActionState(updateBranding, GYM_INIT);
  const [logoState, logoAction, logoPending] = useActionState(uploadLogo, GYM_INIT);
  const [payoutState, payoutAction, payoutPending] = useActionState(savePayout, GYM_INIT);

  return (
    <>
      <div className="page-h"><div><h1>Settings</h1><p>{gym.name} · manage your gym, branding and integrations</p></div></div>

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
              <form className="panel" action={gymAction}>
                <div className="panel-title">Gym profile</div>
                <div className="panel-desc">Public details shown to members on your subdomain.</div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Gym name</label><input className="gf-input" name="name" defaultValue={gym.name} required /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Subdomain</label><input className="gf-input" defaultValue={`${gym.slug}.gymflow.ng`} disabled /></div>
                </div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Phone</label><input className="gf-input" name="phone" defaultValue={gym.phone ?? ''} /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Email</label><input className="gf-input" name="email" type="email" defaultValue={gym.email ?? ''} /></div>
                </div>
                <div className="gf-form-group" style={{ marginBottom: 18 }}><label className="gf-form-label">Address</label><input className="gf-input" name="address" defaultValue={gym.address ?? ''} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={gymPending}>{gymPending ? 'Saving…' : 'Save changes'}</button>
                  {gymState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {gymState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{gymState.error}</span>}
                </div>
              </form>
            </section>
          )}

          {sec === 'branding' && (
            <section className="sec on">
              <form className="panel" action={logoAction} style={{ marginBottom: 18 }}>
                <div className="panel-title">Logo</div>
                <div className="panel-desc">Appears across the member app.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                  {gym.logo_url
                    ? // eslint-disable-next-line @next/next/no-img-element
                      <img src={gym.logo_url} alt="Gym logo" width={56} height={56} style={{ borderRadius: 12, objectFit: 'cover', background: 'var(--gf-elevated)' }} />
                    : <Image src="/images/logomark-v2.svg" alt="" width={56} height={56} />}
                  <input type="file" name="logo" accept="image/*" className="gf-input" style={{ padding: 8 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={logoPending}>{logoPending ? 'Uploading…' : 'Upload logo'}</button>
                  {logoState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Uploaded ✓</span>}
                  {logoState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{logoState.error}</span>}
                </div>
              </form>
              <form className="panel" action={brandAction}>
                <div className="panel-title">Accent colour</div>
                <div className="panel-desc">Re-tints the member app.</div>
                <div className="swatches">
                  {SWATCHES.map((c) => (
                    <label key={c} className="swatch" style={{ background: c }} title={c}>
                      <input type="radio" name="brand_color" value={c} defaultChecked={(gym.brand_color ?? '#11d18b') === c} />
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={brandPending}>{brandPending ? 'Saving…' : 'Save colour'}</button>
                  {brandState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {brandState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{brandState.error}</span>}
                </div>
              </form>
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

          {sec === 'payouts' && (
            <section className="sec on">
              <form className="panel" action={payoutAction}>
                <div className="panel-title">Payout account</div>
                <div className="panel-desc">
                  Where member dues settle. {gym.payouts_connected ? 'Connected to Paystack — collections settle to this account (T+1).' : 'Add your bank to receive member payments directly.'}
                  {gym.commission_pct > 0 ? ` Platform fee: ${gym.commission_pct}%.` : ''}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <span className={`gf-badge ${gym.payouts_connected ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{gym.payouts_connected ? 'Payouts connected' : 'Not connected'}</span>
                </div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Bank name</label><input className="gf-input" name="bank_name" defaultValue={gym.bank_name ?? ''} placeholder="e.g. GTBank" required /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Bank code</label><input className="gf-input" name="bank_code" defaultValue={gym.bank_code ?? ''} placeholder="e.g. 058" inputMode="numeric" required /></div>
                </div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Account number</label><input className="gf-input" name="account_number" defaultValue={gym.account_number ?? ''} placeholder="10 digits" inputMode="numeric" maxLength={10} required /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Account name</label><input className="gf-input" name="account_name" defaultValue={gym.account_name ?? ''} required /></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={payoutPending}>{payoutPending ? 'Saving…' : (gym.payouts_connected ? 'Update payout account' : 'Connect payouts')}</button>
                  {payoutState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {payoutState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{payoutState.error}</span>}
                </div>
              </form>
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
                <div className="set-row"><div className="m"><strong>{staffCount} active staff member{staffCount === 1 ? '' : 's'}</strong><small>Manage roles on the Staff page</small></div><Link href="/admin/instructors" className="gf-btn gf-btn-secondary gf-btn-sm" style={{ textDecoration: 'none' }}>Manage</Link></div>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

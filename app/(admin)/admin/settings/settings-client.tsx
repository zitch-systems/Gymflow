'use client';

import { useState, useActionState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Building2, Palette, Clock, Bell, Plug, Users, CreditCard, MessageCircle, Mail, Banknote, Snowflake } from 'lucide-react';
import { updateGym, updateBranding, uploadLogo, saveBusinessHours, updateFreezePolicy, type GymSaveState } from '@/lib/actions/gym';
import { PayoutForm } from '@/components/admin/payout-form';
import type { Bank } from '@/lib/paystack';

const GYM_INIT: GymSaveState = { ok: false, error: null };
const SWATCHES = ['#11d18b', '#4080ff', '#ff4560', '#c6f24e', '#b67bf3', '#f59e0b', '#06b6d4'];

const NAV = [
  { id: 'profile', label: 'Gym profile', icon: Building2 },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'hours', label: 'Business hours', icon: Clock },
  { id: 'membership', label: 'Membership', icon: Snowflake },
  { id: 'payouts', label: 'Payouts', icon: Banknote },
  { id: 'notif', label: 'Notifications', icon: Bell },
  { id: 'integ', label: 'Integrations', icon: Plug },
  { id: 'team', label: 'Team', icon: Users },
] as const;

// Mon-anchored display order for the editable weekly grid.
const DAY_ORDER: [number, string][] = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];

const INTEG = [
  { icon: CreditCard, name: 'Paystack', sub: 'Subscriptions & auto-debit', st: ['gf-badge-success', 'Connected'] },
  { icon: MessageCircle, name: 'WhatsApp (Termii)', sub: 'Reminder & receipt delivery', st: ['gf-badge-success', 'Connected'] },
  { icon: Mail, name: 'Email (Resend)', sub: 'Transactional email', st: ['gf-badge-success', 'Connected'] },
];

export type GymProfile = {
  name: string; slug: string; phone: string | null; email: string | null; address: string | null; brand_color: string | null; logo_url: string | null;
  bank_name: string | null; bank_code: string | null; account_number: string | null; account_name: string | null;
  payouts_connected: boolean; commission_pct: number;
  member_freeze_enabled: boolean;
};

export type BusinessHour = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean };

export function SettingsClient({ gym, staffCount, banks, hours }: { gym: GymProfile; staffCount: number; banks: Bank[]; hours: BusinessHour[] }) {
  const [sec, setSec] = useState<string>('profile');
  const [gymState, gymAction, gymPending] = useActionState(updateGym, GYM_INIT);
  const [brandState, brandAction, brandPending] = useActionState(updateBranding, GYM_INIT);
  const [logoState, logoAction, logoPending] = useActionState(uploadLogo, GYM_INIT);
  const [hoursState, hoursAction, hoursPending] = useActionState(saveBusinessHours, GYM_INIT);
  const [freezeState, freezeAction, freezePending] = useActionState(updateFreezePolicy, GYM_INIT);
  const hoursByDay = new Map(hours.map((h) => [h.day_of_week, h]));

  return (
    <>
      <div className="page-h"><div><h1>Settings</h1><p>{gym.name} · manage your gym, branding and integrations</p></div></div>

      <div className="set-wrap">
        <nav className="subnav">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <button type="button" key={n.id} className={sec === n.id ? 'on' : undefined} onClick={() => setSec(n.id)} aria-current={sec === n.id ? 'true' : undefined}>
                <Icon strokeWidth={1.75} /> {n.label}
              </button>
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
                  <div className="gf-form-group"><label className="gf-form-label">Subdomain</label><input className="gf-input" defaultValue={`${gym.slug}.gymflow.ng`} disabled /><a href={`/g/${gym.slug}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 7, fontSize: '0.78rem', fontWeight: 600, color: 'var(--gf-brand)', textDecoration: 'none' }}>View public page ↗</a></div>
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
                    : <Image src="/images/logomark-v3.svg" alt="" width={56} height={56} />}
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
              <form className="panel" action={hoursAction}>
                <div className="panel-title">Business hours</div>
                <div className="panel-desc">When members can check in and book. Shown on your public page.</div>
                <div className="hours-edit">
                  {DAY_ORDER.map(([d, label]) => {
                    const h = hoursByDay.get(d);
                    return (
                      <div className="hrow-edit" key={d}>
                        <div className="dn">{label}</div>
                        <label className="hclosed"><input type="checkbox" name={`closed_${d}`} defaultChecked={h?.is_closed ?? false} /> Closed</label>
                        <div className="htimes">
                          <input className="gf-input" type="time" name={`open_${d}`} defaultValue={h?.open_time ?? '05:00'} aria-label={`${label} open`} />
                          <span>—</span>
                          <input className="gf-input" type="time" name={`close_${d}`} defaultValue={h?.close_time ?? '22:00'} aria-label={`${label} close`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={hoursPending}>{hoursPending ? 'Saving…' : 'Save hours'}</button>
                  {hoursState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {hoursState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{hoursState.error}</span>}
                </div>
              </form>
            </section>
          )}

          {sec === 'membership' && (
            <section className="sec on">
              <form className="panel" action={freezeAction}>
                <div className="panel-title">Membership freezes</div>
                <div className="panel-desc">Control whether members can pause their own membership from the app. Staff can always freeze a membership manually from the member page.</div>
                <label className="set-row" style={{ cursor: 'pointer' }}>
                  <div className="m">
                    <strong>Allow members to request freezes</strong>
                    <small>Members see a “Freeze membership” option in their profile. Requests still need staff approval.</small>
                  </div>
                  <input type="checkbox" name="member_freeze_enabled" defaultChecked={gym.member_freeze_enabled} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={freezePending}>{freezePending ? 'Saving…' : 'Save changes'}</button>
                  {freezeState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {freezeState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{freezeState.error}</span>}
                </div>
              </form>
            </section>
          )}

          {sec === 'payouts' && (
            <section className="sec on">
              <PayoutForm gym={gym} banks={banks} />
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

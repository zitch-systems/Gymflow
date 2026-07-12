'use client';

import { useState, useActionState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Building2, Palette, Clock, Bell, Plug, Users, CreditCard, MessageCircle, Mail, Banknote, Snowflake } from 'lucide-react';
import { updateGym, updateBranding, uploadLogo, saveBusinessHours, updateFreezePolicy, updateNotifications, type GymSaveState } from '@/lib/actions/gym';
import { PayoutForm } from '@/components/admin/payout-form';
import type { Bank } from '@/lib/paystack';
import { fmt12Hr } from '@/lib/format';

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
  tagline: string | null; description: string | null; city: string | null; state: string | null; website: string | null; amenities: string[] | null;
  bank_name: string | null; bank_code: string | null; account_number: string | null; account_name: string | null;
  payouts_connected: boolean; payouts_locked: boolean; commission_pct: number;
  member_freeze_enabled: boolean;
  notif_class_reminders: boolean; notif_renewal_nudges: boolean; notif_payment_receipts: boolean;
};

export type BusinessHour = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean; session: 'all' | 'morning' | 'afternoon' | 'evening' };

export function SettingsClient({ gym, staffCount, banks, hours, pendingPayoutRequests }: { gym: GymProfile; staffCount: number; banks: Bank[]; hours: BusinessHour[]; pendingPayoutRequests: number }) {
  const [sec, setSec] = useState<string>('profile');
  const [gymState, gymAction, gymPending] = useActionState(updateGym, GYM_INIT);
  const [brandState, brandAction, brandPending] = useActionState(updateBranding, GYM_INIT);
  const [logoState, logoAction, logoPending] = useActionState(uploadLogo, GYM_INIT);
  const [hoursState, hoursAction, hoursPending] = useActionState(saveBusinessHours, GYM_INIT);
  const [freezeState, freezeAction, freezePending] = useActionState(updateFreezePolicy, GYM_INIT);
  const [notifState, notifAction, notifPending] = useActionState(updateNotifications, GYM_INIT);

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
                <div className="panel-desc">Public details shown to members on your subdomain. Membership prices live under Pricing and classes under Classes.</div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Gym name</label><input className="gf-input" name="name" defaultValue={gym.name} required /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Subdomain</label><input className="gf-input" defaultValue={`${gym.slug}.gymflow.ng`} disabled /><a href={`/g/${gym.slug}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 7, fontSize: '0.78rem', fontWeight: 600, color: 'var(--gf-brand)', textDecoration: 'none' }}>View public page ↗</a></div>
                </div>
                <div className="gf-form-group"><label className="gf-form-label">Tagline</label><input className="gf-input" name="tagline" defaultValue={gym.tagline ?? ''} placeholder="One line shown under your gym name" maxLength={120} /></div>
                <div className="gf-form-group"><label className="gf-form-label">About</label><textarea className="gf-input" name="description" defaultValue={gym.description ?? ''} rows={4} placeholder="Tell members what makes your gym different." style={{ resize: 'vertical', minHeight: 92 }} /></div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">City</label><input className="gf-input" name="city" defaultValue={gym.city ?? ''} /></div>
                  <div className="gf-form-group"><label className="gf-form-label">State</label><input className="gf-input" name="state" defaultValue={gym.state ?? ''} /></div>
                </div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Phone</label><input className="gf-input" name="phone" defaultValue={gym.phone ?? ''} /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Email</label><input className="gf-input" name="email" type="email" defaultValue={gym.email ?? ''} /></div>
                </div>
                <div className="gf-form-group"><label className="gf-form-label">Address</label><input className="gf-input" name="address" defaultValue={gym.address ?? ''} /></div>
                <div className="gf-form-group"><label className="gf-form-label">Website</label><input className="gf-input" name="website" type="url" defaultValue={gym.website ?? ''} placeholder="https://" /></div>
                <div className="gf-form-group" style={{ marginBottom: 18 }}><label className="gf-form-label">Amenities</label><input className="gf-input" name="amenities" defaultValue={(gym.amenities ?? []).join(', ')} placeholder="Free parking, Sauna, 24/7 access" /><small style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)', fontSize: '0.78rem' }}>Separate each with a comma. Shown as tags on your public page.</small></div>
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
                <div className="panel-desc">When members can check in and book. Times display in AM/PM. Pick <em>Open all day</em> for one range, or <em>Split sessions</em> to open only for morning, afternoon, or evening slots.</div>
                <div className="hours-edit">
                  {DAY_ORDER.map(([d, label]) => (
                    <DayHoursEditor key={d} d={d} label={label} rows={hours.filter((h) => h.day_of_week === d)} />
                  ))}
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
              {pendingPayoutRequests > 0 && (
                <div className="panel" style={{ borderColor: 'var(--gf-warning)', background: 'var(--gf-warning-soft, rgba(245,158,11,0.08))', marginBottom: 12 }}>
                  <div className="panel-title" style={{ color: 'var(--gf-warning)' }}>Change pending review</div>
                  <div className="panel-desc">You have {pendingPayoutRequests} payout-account change request{pendingPayoutRequests === 1 ? '' : 's'} awaiting platform review. Your current bank stays active until it&rsquo;s approved.</div>
                </div>
              )}
              <PayoutForm gym={gym} banks={banks} />
            </section>
          )}

          {sec === 'notif' && (
            <section className="sec on">
              <form className="panel" action={notifAction}>
                <div className="panel-title">Notifications</div>
                <div className="panel-desc">Automated reminders sent to members. Toggle a channel off to stop those messages platform-wide for this gym.</div>
                <label className="set-row" style={{ cursor: 'pointer' }}>
                  <div className="m"><strong>Class reminders</strong><small>WhatsApp + push, 1 hour before</small></div>
                  <input type="checkbox" name="notif_class_reminders" defaultChecked={gym.notif_class_reminders} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
                </label>
                <label className="set-row" style={{ cursor: 'pointer' }}>
                  <div className="m"><strong>Renewal nudges</strong><small>Email + WhatsApp before expiry</small></div>
                  <input type="checkbox" name="notif_renewal_nudges" defaultChecked={gym.notif_renewal_nudges} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
                </label>
                <label className="set-row" style={{ cursor: 'pointer' }}>
                  <div className="m"><strong>Payment receipts</strong><small>Emailed on every charge</small></div>
                  <input type="checkbox" name="notif_payment_receipts" defaultChecked={gym.notif_payment_receipts} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={notifPending}>{notifPending ? 'Saving…' : 'Save changes'}</button>
                  {notifState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {notifState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{notifState.error}</span>}
                </div>
              </form>
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

// Per-day hours editor. Three modes:
//   'single' — one open/close range that runs all day (the default).
//   'split'  — up to three named sessions (morning/afternoon/evening), each
//              individually toggleable and time-picked.
//   'closed' — no rows saved for the day.
// Times are stored as 24h "HH:MM" but a live AM/PM read-out sits next to each
// picker so owners always see the format members will actually see.
type SessionKey = 'morning' | 'afternoon' | 'evening';
const SESSIONS: { key: SessionKey; label: string; open: string; close: string }[] = [
  { key: 'morning',   label: 'Morning',   open: '05:00', close: '12:00' },
  { key: 'afternoon', label: 'Afternoon', open: '12:00', close: '17:00' },
  { key: 'evening',   label: 'Evening',   open: '17:00', close: '22:00' },
];

function DayHoursEditor({ d, label, rows }: { d: number; label: string; rows: BusinessHour[] }) {
  const singleRow = rows.find((r) => r.session === 'all');
  const splitRows = new Map(rows.filter((r) => r.session !== 'all').map((r) => [r.session as SessionKey, r]));
  const initialMode: 'single' | 'split' | 'closed' =
    rows.length && rows.every((r) => r.is_closed) ? 'closed'
    : splitRows.size > 0 ? 'split'
    : 'single';

  const [mode, setMode] = useState<'single' | 'split' | 'closed'>(initialMode);
  const [singleOpen, setSingleOpen] = useState(singleRow?.open_time ?? (d === 0 || d === 6 ? '07:00' : '05:00'));
  const [singleClose, setSingleClose] = useState(singleRow?.close_time ?? (d === 0 || d === 6 ? '20:00' : '22:00'));

  return (
    <div className="hrow-edit hrow-multi" data-mode={mode}>
      <div className="dn">{label}</div>
      <input type="hidden" name={`mode_${d}`} value={mode} />
      <div className="hmode" role="tablist" aria-label={`${label} hours mode`}>
        <button type="button" className={mode === 'single' ? 'on' : undefined} onClick={() => setMode('single')} role="tab" aria-selected={mode === 'single'}>Open all day</button>
        <button type="button" className={mode === 'split'  ? 'on' : undefined} onClick={() => setMode('split')}  role="tab" aria-selected={mode === 'split'}>Split sessions</button>
        <button type="button" className={mode === 'closed' ? 'on' : undefined} onClick={() => setMode('closed')} role="tab" aria-selected={mode === 'closed'}>Closed</button>
      </div>

      {mode === 'single' && (
        <div className="htimes">
          <input className="gf-input" type="time" name={`open_${d}`}  value={singleOpen}  onChange={(e) => setSingleOpen(e.target.value)}  aria-label={`${label} open`} />
          <span className="hampm">{fmt12Hr(singleOpen)}</span>
          <span>—</span>
          <input className="gf-input" type="time" name={`close_${d}`} value={singleClose} onChange={(e) => setSingleClose(e.target.value)} aria-label={`${label} close`} />
          <span className="hampm">{fmt12Hr(singleClose)}</span>
        </div>
      )}

      {mode === 'split' && (
        <div className="hsessions">
          {SESSIONS.map((s) => (
            <SplitRow key={s.key} d={d} spec={s} row={splitRows.get(s.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SplitRow({ d, spec, row }: { d: number; spec: { key: SessionKey; label: string; open: string; close: string }; row: BusinessHour | undefined }) {
  const [enabled, setEnabled] = useState(!!row);
  const [open, setOpen] = useState(row?.open_time ?? spec.open);
  const [close, setClose] = useState(row?.close_time ?? spec.close);
  return (
    <div className="hsession" data-enabled={enabled}>
      <label className="hs-tog">
        <input type="checkbox" name={`enabled_${d}_${spec.key}`} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {spec.label}
      </label>
      {enabled && (
        <div className="htimes">
          <input className="gf-input" type="time" name={`open_${d}_${spec.key}`}  value={open}  onChange={(e) => setOpen(e.target.value)}  aria-label={`${spec.label} open`} />
          <span className="hampm">{fmt12Hr(open)}</span>
          <span>—</span>
          <input className="gf-input" type="time" name={`close_${d}_${spec.key}`} value={close} onChange={(e) => setClose(e.target.value)} aria-label={`${spec.label} close`} />
          <span className="hampm">{fmt12Hr(close)}</span>
        </div>
      )}
    </div>
  );
}

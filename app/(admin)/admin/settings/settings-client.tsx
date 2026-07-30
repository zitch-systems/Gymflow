'use client';

import { useState, useActionState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Building2, Dumbbell, Palette, Clock, Bell, Plug, Users, CreditCard, MessageCircle, Mail, Banknote, Snowflake, Fingerprint, Calculator, Smartphone, Copy, Check, ShieldCheck, type LucideIcon } from 'lucide-react';
import { updateGym, updateBranding, uploadLogo, saveBusinessHours, updateFreezePolicy, updateNotifications, updateMarketing, updateSecurity, uploadCacCertificate, type GymSaveState } from '@/lib/actions/gym';
import { formatCacNumber } from '@/lib/cac';
import { PayoutAccounts, type PayoutAccount } from '@/components/admin/payout-accounts';
import { GalleryManager } from '@/components/admin/gallery-manager';
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
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'integ', label: 'Integrations', icon: Plug },
  { id: 'team', label: 'Team', icon: Users },
] as const;

// Mon-anchored display order for the editable weekly grid.
const DAY_ORDER: [number, string][] = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];

// Core delivery providers. Whether each is live comes from the server page
// (real env configuration) — the badge must never claim "Connected" for a
// channel that has no key, or owners believe reminders are reaching members
// when they are not.
const INTEG = [
  { icon: CreditCard, name: 'Paystack', sub: 'Subscriptions & auto-debit', key: 'paystack' as const, domain: 'paystack.com' },
  { icon: MessageCircle, name: 'WhatsApp (Termii)', sub: 'Reminder delivery', key: 'termii' as const, domain: 'termii.com' },
  { icon: Mail, name: 'Email (Resend)', sub: 'Reminders & receipts', key: 'resend' as const, domain: 'resend.com' },
];

export type ProviderStatus = { paystack: boolean; termii: boolean; resend: boolean };

// HR / payroll systems. These sync staff records and payroll for the gym's
// team. Each needs the provider's API credentials to be enabled per gym, so
// they start disconnected and route to the platform team to switch on.
const HR_INTEG = [
  // Nigerian / African providers first — the primary market.
  { name: 'SeamlessHR', sub: 'HR & payroll — Nigeria & Africa', domain: 'seamlesshr.com' },
  { name: 'PaidHR', sub: 'Payroll, payments & benefits — Nigeria', domain: 'paidhr.com' },
  { name: 'Bento', sub: 'Payroll & benefits — Nigeria', domain: 'bento.africa' },
  { name: 'Ropay', sub: 'Payroll & HR — Nigeria', domain: 'ropay.africa' },
  { name: 'HumanManager', sub: 'HR & payroll (SystemSpecs) — Nigeria', domain: 'humanmanager.co' },
  { name: 'Workpay', sub: 'HR & payroll — Africa', domain: 'workpay.co' },
  // Global HCM suites.
  { name: 'BambooHR', sub: 'Staff records & time off', domain: 'bamboohr.com' },
  { name: 'Zoho People', sub: 'HR management suite', domain: 'zoho.com' },
  { name: 'Workday', sub: 'Enterprise HCM & payroll', domain: 'workday.com' },
];

// Access control / entry hardware. These tie physical entry (turnstiles, card
// readers, biometrics) to the member's subscription + check-in status, so only
// active members get through the door. Provisioning needs the venue's hardware
// details, so they route to the platform team like the HR catalog.
// Only the two branded terminal vendors get a real logo — the rest of this
// list is generic hardware categories (any gate/reader/scanner), not a
// single company, so they keep the section's fallback icon.
const ACCESS_INTEG = [
  { name: 'ZKTeco', sub: 'Biometric & RFID access terminals', domain: 'zkteco.com' },
  { name: 'Hikvision', sub: 'Turnstiles & face / RFID readers', domain: 'hikvision.com' },
  { name: 'Turnstile / gate controller', sub: 'QR or RFID entry gates tied to check-in' },
  { name: 'RFID / NFC card readers', sub: 'Tap-card member entry' },
  { name: 'Fingerprint scanners', sub: 'Biometric check-in at the door' },
];

// Accounting & tax. Sync revenue/receipts into the gym's books and support
// Nigerian VAT/tax filing. A self-service CSV export (see Wallet) covers the
// generic case today; these connectors push data directly once enabled.
const ACCOUNTING_INTEG = [
  { name: 'Zoho Books', sub: 'Cloud accounting & invoicing', domain: 'zoho.com' },
  { name: 'QuickBooks', sub: 'Bookkeeping & financial reports', domain: 'quickbooks.intuit.com' },
  { name: 'Sage', sub: 'Accounting & payroll', domain: 'sage.com' },
  { name: 'Kippa', sub: 'Bookkeeping for SMEs — Nigeria', domain: 'kippa.africa' },
  { name: 'Bumpa', sub: 'Sales & bookkeeping — Nigeria', domain: 'getbumpa.com' },
  { name: 'FIRS TaxPro-Max', sub: 'VAT & company tax filing — Nigeria', domain: 'firs.gov.ng' },
];

// Renders a provider's real logo (via a favicon service, keyed off its
// domain) and falls back to the section's generic icon if the domain is
// missing or the image fails to load — no local copies of trademarked
// logos to source or keep in sync.
function ProviderMark({ domain, icon: Icon }: { domain?: string; icon: LucideIcon }) {
  const [broken, setBroken] = useState(false);
  if (!domain || broken) {
    return <div className="ig" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><Icon strokeWidth={1.75} /></div>;
  }
  return (
    <div className="ig" style={{ background: '#fff', border: '1px solid var(--gf-border)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny external favicon, not worth Image's remote-pattern config */}
      <img
        src={`https://www.google.com/s2/favicons?sz=128&domain=${domain}`}
        alt=""
        width={24}
        height={24}
        style={{ width: 24, height: 24, objectFit: 'contain' }}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

// A catalog of providers that each need per-gym credentials/hardware the
// platform enables. "Request setup" opens a pre-filled email to support.
function RequestSetupPanel({ title, desc, items, icon: Icon, gymName, gymSlug }: {
  title: string; desc: string; items: { name: string; sub: string; domain?: string }[]; icon: LucideIcon; gymName: string; gymSlug: string;
}) {
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-title">{title}</div>
      <div className="panel-desc">{desc}</div>
      {items.map((it) => (
        <div className="integ" key={it.name}>
          <ProviderMark domain={it.domain} icon={Icon} />
          <div className="m"><strong>{it.name}</strong><small>{it.sub}</small></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span className="gf-badge gf-badge-neutral"><span className="gf-dot" />Not connected</span>
            <a
              className="gf-btn gf-btn-secondary gf-btn-sm"
              href={`mailto:support@gymflow.ng?subject=${encodeURIComponent(`Connect ${it.name} for ${gymName}`)}&body=${encodeURIComponent(`We'd like to connect ${it.name} to our GymFlow gym "${gymName}" (${gymSlug}). Please help us enable it.`)}`}
              style={{ textDecoration: 'none' }}
            >
              Request setup
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

export type GymProfile = {
  name: string; slug: string; member_code: string | null; phone: string | null; email: string | null; address: string | null; brand_color: string | null; logo_url: string | null;
  tagline: string | null; description: string | null; city: string | null; state: string | null; website: string | null; amenities: string[] | null;
  social_links: Record<string, string> | null; gallery_urls: string[] | null; instagram_posts: string[] | null;
  integrations: Record<string, string> | null;
  bank_name: string | null; bank_code: string | null; account_number: string | null; account_name: string | null;
  payouts_connected: boolean; payouts_locked: boolean; commission_pct: number;
  member_freeze_enabled: boolean;
  notif_class_reminders: boolean; notif_renewal_nudges: boolean; notif_payment_receipts: boolean;
  notif_membership_updates: boolean;
  two_factor_required: boolean;
  cac_number: string | null;
};

export type BusinessHour = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean; session: 'all' | 'morning' | 'afternoon' | 'evening' };

const VALID_SECTIONS = new Set(['profile', 'branding', 'hours', 'membership', 'payouts', 'notif', 'security', 'integ', 'team']);

// The gym's member code for the native mobile app — members type it into the
// app to reach this gym, then sign in / up. Read-only, with a copy button.
function MemberCodeField({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }
  return (
    <div className="gf-form-group">
      <label className="gf-form-label"><Smartphone size={13} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 5 }} />Mobile app code</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="gf-input" value={code} readOnly style={{ maxWidth: 180, fontFamily: 'var(--gf-font-mono, monospace)', fontWeight: 700, letterSpacing: '0.12em', fontSize: '1.05rem' }} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="gf-btn gf-btn-secondary gf-btn-sm" onClick={copy}>
          {copied ? <><Check size={14} strokeWidth={2.4} /> Copied</> : <><Copy size={14} strokeWidth={2} /> Copy</>}
        </button>
      </div>
      <span className="gf-form-hint" style={{ color: 'var(--gf-text-muted)' }}>Share this with members so they can find your gym in the GymFlow mobile app — they enter it once, then sign in or sign up.</span>
    </div>
  );
}

export function SettingsClient({ gym, staffCount, banks, hours, payoutAccounts, initialSection = 'profile', providers = { paystack: false, termii: false, resend: false }, cacUrl = null }: { gym: GymProfile; staffCount: number; banks: Bank[]; hours: BusinessHour[]; payoutAccounts: PayoutAccount[]; initialSection?: string; providers?: ProviderStatus; cacUrl?: string | null }) {
  const [sec, setSec] = useState<string>(initialSection);
  // Follow the ?onboarding=/?section= query on client-side navigation too.
  // Clicking an onboarding-banner link while ALREADY on /admin/settings changes
  // only the query — the component doesn't remount, so the initial `sec` state
  // would otherwise stay put and the tab wouldn't switch. Adjust state during
  // render when the requested section changes (React's sanctioned pattern for
  // deriving state from changing inputs — no effect, no cascading renders).
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get('onboarding') ?? searchParams.get('section');
  const [prevRequested, setPrevRequested] = useState(requestedSection);
  if (requestedSection !== prevRequested) {
    setPrevRequested(requestedSection);
    if (requestedSection && VALID_SECTIONS.has(requestedSection)) setSec(requestedSection);
  }
  const [gymState, gymAction, gymPending] = useActionState(updateGym, GYM_INIT);
  const [brandState, brandAction, brandPending] = useActionState(updateBranding, GYM_INIT);
  const [logoState, logoAction, logoPending] = useActionState(uploadLogo, GYM_INIT);
  const [hoursState, hoursAction, hoursPending] = useActionState(saveBusinessHours, GYM_INIT);
  const [freezeState, freezeAction, freezePending] = useActionState(updateFreezePolicy, GYM_INIT);
  const [notifState, notifAction, notifPending] = useActionState(updateNotifications, GYM_INIT);
  const [secState, secAction, secPending] = useActionState(updateSecurity, GYM_INIT);
  const [cacState, cacAction, cacPending] = useActionState(uploadCacCertificate, GYM_INIT);
  const [mktState, mktAction, mktPending] = useActionState(updateMarketing, GYM_INIT);

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
                {gym.member_code && <MemberCodeField code={gym.member_code} />}
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
                <div className="gf-form-group"><label className="gf-form-label">Amenities</label><input className="gf-input" name="amenities" defaultValue={(gym.amenities ?? []).join(', ')} placeholder="Free parking, Sauna, 24/7 access" /><small style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)', fontSize: '0.78rem' }}>Separate each with a comma. Shown as tags on your public page.</small></div>

                <div className="gf-form-group">
                  <label className="gf-form-label" htmlFor="cac-number">CAC registration number</label>
                  <input className="gf-input" id="cac-number" name="cac_number" defaultValue={formatCacNumber(gym.cac_number)} placeholder="RC 1234567" />
                  <small style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)', fontSize: '0.78rem' }}>
                    Your Corporate Affairs Commission number — RC for a company, BN for a business name, IT for incorporated trustees. Kept private; used to verify the business behind your payout account.
                  </small>
                </div>

                <div className="panel-title" style={{ marginTop: 8 }}>Social media</div>
                <div className="panel-desc">Handle or full link — shown as icons on your public page.</div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">Instagram</label><input className="gf-input" name="social_instagram" defaultValue={gym.social_links?.instagram ?? ''} placeholder="@yourgym" /></div>
                  <div className="gf-form-group"><label className="gf-form-label">Facebook</label><input className="gf-input" name="social_facebook" defaultValue={gym.social_links?.facebook ?? ''} placeholder="yourgym or link" /></div>
                </div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">TikTok</label><input className="gf-input" name="social_tiktok" defaultValue={gym.social_links?.tiktok ?? ''} placeholder="@yourgym" /></div>
                  <div className="gf-form-group"><label className="gf-form-label">X (Twitter)</label><input className="gf-input" name="social_x" defaultValue={gym.social_links?.x ?? ''} placeholder="@yourgym" /></div>
                </div>
                <div className="frow">
                  <div className="gf-form-group"><label className="gf-form-label">YouTube</label><input className="gf-input" name="social_youtube" defaultValue={gym.social_links?.youtube ?? ''} placeholder="channel or link" /></div>
                  <div className="gf-form-group"><label className="gf-form-label">WhatsApp</label><input className="gf-input" name="social_whatsapp" defaultValue={gym.social_links?.whatsapp ?? ''} placeholder="2348012345678" /></div>
                </div>

                <div className="panel-title" style={{ marginTop: 8 }}>Featured Instagram posts</div>
                <div className="panel-desc">Paste up to 6 Instagram post or reel links (one per line) to feature them in an &ldquo;On Instagram&rdquo; section on your public page. Open a post on Instagram → Share → Copy link. Swap the links whenever you want to feature newer posts.</div>
                <div className="gf-form-group">
                  <textarea className="gf-input" name="instagram_posts" rows={4} defaultValue={(gym.instagram_posts ?? []).join('\n')} placeholder={'https://www.instagram.com/p/XXXXXXXXX/\nhttps://www.instagram.com/reel/YYYYYYYYY/'} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
                  <small style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)', fontSize: '0.78rem' }}>Only valid instagram.com post/reel links are kept. Posts must be public to display.</small>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={gymPending}>{gymPending ? 'Saving…' : 'Save changes'}</button>
                  {gymState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {gymState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{gymState.error}</span>}
                </div>
              </form>
            </section>
          )}

          {sec === 'profile' && (
            <section className="sec on" style={{ marginTop: 16 }}>
              {/* Its own <form> and its own action: a file upload nested inside
                  the profile form would post the whole profile on every file
                  pick, and multipart uploads have their own failure modes. */}
              <form className="panel" action={cacAction}>
                <div className="panel-title">CAC certificate</div>
                <div className="panel-desc">
                  Your certificate of incorporation. Stored privately — only your gym&apos;s staff and GymFlow can open it, through a link that expires after ten minutes. Never shown on your public page.
                </div>
                {cacUrl ? (
                  <div className="set-row">
                    <div className="m">
                      <strong>Certificate on file</strong>
                      <small>Uploading a new one replaces it.</small>
                    </div>
                    <a href={cacUrl} target="_blank" rel="noreferrer" className="gf-btn gf-btn-ghost" style={{ flexShrink: 0 }}>View ↗</a>
                  </div>
                ) : (
                  <div className="set-row">
                    <div className="m">
                      <strong>No certificate uploaded</strong>
                      <small>PDF, PNG, JPEG or WebP, up to 5 MB.</small>
                    </div>
                  </div>
                )}
                <div className="gf-form-group" style={{ marginTop: 12 }}>
                  <label className="gf-form-label" htmlFor="cac-file">{cacUrl ? 'Replace certificate' : 'Upload certificate'}</label>
                  <input className="gf-input" id="cac-file" name="certificate" type="file" accept=".pdf,image/png,image/jpeg,image/webp" required />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={cacPending}>{cacPending ? 'Uploading…' : 'Upload'}</button>
                  {cacState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Uploaded ✓</span>}
                  {cacState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{cacState.error}</span>}
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
                  {/* Placeholder is deliberately neutral, not GymFlow's mark: this
                      slot is the GYM's logo, and showing Flowbell here reads as
                      "your logo is GymFlow's". */}
                  {gym.logo_url
                    ? <Image src={gym.logo_url} alt="Gym logo" width={56} height={56} style={{ borderRadius: 12, objectFit: 'cover', background: 'var(--gf-elevated)' }} />
                    : (
                      <span aria-hidden style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--gf-elevated)', border: '1px solid var(--gf-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gf-text-muted)' }}>
                        <Dumbbell strokeWidth={1.75} />
                      </span>
                    )}
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
              <div style={{ marginTop: 18 }}>
                <GalleryManager photos={gym.gallery_urls ?? []} />
              </div>
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
              <PayoutAccounts
                accounts={payoutAccounts}
                meta={{ payouts_connected: gym.payouts_connected, commission_pct: gym.commission_pct }}
                banks={banks}
              />
            </section>
          )}

          {sec === 'notif' && (
            <section className="sec on">
              <form className="panel" action={notifAction}>
                <div className="panel-title">Notifications</div>
                <div className="panel-desc">Automated reminders sent to members. Toggle a channel off to stop those messages platform-wide for this gym.</div>
                <label className="set-row" style={{ cursor: 'pointer' }}>
                  <div className="m"><strong>Class reminders</strong><small>A morning email of each member&apos;s classes for the day</small></div>
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
                <label className="set-row" style={{ cursor: 'pointer' }}>
                  <div className="m"><strong>Membership updates</strong><small>Pauses, freezes and status changes to a member&apos;s plan</small></div>
                  <input type="checkbox" name="notif_membership_updates" defaultChecked={gym.notif_membership_updates} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={notifPending}>{notifPending ? 'Saving…' : 'Save changes'}</button>
                  {notifState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {notifState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{notifState.error}</span>}
                </div>
              </form>
            </section>
          )}

          {sec === 'security' && (
            <section className="sec on">
              <form className="panel" action={secAction}>
                <div className="panel-title">Security</div>
                <div className="panel-desc">How staff prove who they are when signing in to this gym&apos;s console.</div>
                <label className="set-row" style={{ cursor: 'pointer' }}>
                  <div className="m">
                    <strong>Two-factor sign-in</strong>
                    <small>Staff enter a 6-digit code emailed to them, on top of their password. Applies to every staff account here — owner, managers, front desk, accountants and instructors.</small>
                  </div>
                  <input type="checkbox" name="two_factor_required" defaultChecked={gym.two_factor_required} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
                </label>
                <p style={{ color: 'var(--gf-text-muted)', fontSize: '0.8rem', lineHeight: 1.5, margin: '10px 2px 0' }}>
                  Staff can tick &ldquo;trust this device&rdquo; to skip the code for 30 days on a browser they use every shift. Turning this off leaves passwords as the only thing between a leaked credential and your member data, payments and payout account.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={secPending}>{secPending ? 'Saving…' : 'Save changes'}</button>
                  {secState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {secState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{secState.error}</span>}
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
                  const live = providers[it.key];
                  return (
                    <div className="integ" key={it.name}>
                      <ProviderMark domain={it.domain} icon={it.icon} />
                      <div className="m"><strong>{it.name}</strong><small>{it.sub}</small></div>
                      <span className={`gf-badge ${live ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{live ? 'Connected' : 'Not configured'}</span>
                    </div>
                  );
                })}
              </div>

              <form className="panel" action={mktAction} style={{ marginTop: 16 }}>
                <div className="panel-title">Marketing, tracking &amp; live chat</div>
                <div className="panel-desc">Add these to your public gym page ({gym.slug}.gymflow.ng) to measure sign-ups and chat with visitors. All are optional and use public IDs only — paste and save.</div>

                <div className="frow" style={{ marginTop: 12 }}>
                  <div className="gf-form-group">
                    <label className="gf-form-label">Google Analytics (GA4) ID</label>
                    <input className="gf-input" name="ga4" defaultValue={gym.integrations?.ga4 ?? ''} placeholder="G-XXXXXXX" />
                    <small className="gf-form-hint" style={{ color: 'var(--gf-text-muted)' }}>Analytics → Admin → Data streams.</small>
                  </div>
                  <div className="gf-form-group">
                    <label className="gf-form-label">Meta (Facebook) Pixel ID</label>
                    <input className="gf-input" name="meta_pixel" defaultValue={gym.integrations?.meta_pixel ?? ''} placeholder="123456789012345" inputMode="numeric" />
                    <small className="gf-form-hint" style={{ color: 'var(--gf-text-muted)' }}>Events Manager → your pixel’s numeric ID.</small>
                  </div>
                </div>

                <div className="frow">
                  <div className="gf-form-group">
                    <label className="gf-form-label">Live chat provider</label>
                    <select className="gf-select" name="chat_provider" defaultValue={gym.integrations?.chat_provider ?? ''}>
                      <option value="">None</option>
                      <option value="crisp">Crisp</option>
                      <option value="tawk">Tawk.to</option>
                    </select>
                  </div>
                  <div className="gf-form-group">
                    <label className="gf-form-label">Chat widget ID</label>
                    <input className="gf-input" name="chat_id" defaultValue={gym.integrations?.chat_id ?? ''} placeholder="Crisp Website ID or Tawk propertyId/widgetId" />
                    <small className="gf-form-hint" style={{ color: 'var(--gf-text-muted)' }}>Crisp: Settings → Setup. Tawk.to: Admin → Channels → Chat Widget.</small>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <button className="gf-btn gf-btn-primary" type="submit" disabled={mktPending}>{mktPending ? 'Saving…' : 'Save changes'}</button>
                  {mktState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
                  {mktState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{mktState.error}</span>}
                </div>
              </form>

              <RequestSetupPanel
                title="Access control & entry hardware"
                desc={`Tie physical entry — turnstiles, card readers and biometrics — to each member's subscription and check-in, so only active members get through the door. Hardware is provisioned per venue: request setup and our team will configure it for ${gym.name}.`}
                items={ACCESS_INTEG}
                icon={Fingerprint}
                gymName={gym.name}
                gymSlug={gym.slug}
              />

              <RequestSetupPanel
                title="Accounting & tax"
                desc={`Sync revenue and receipts into your books and support Nigerian VAT/tax filing. You can already download an accounting-ready CSV from Wallet anytime; these connectors push data directly once enabled for ${gym.name}.`}
                items={ACCOUNTING_INTEG}
                icon={Calculator}
                gymName={gym.name}
                gymSlug={gym.slug}
              />

              <RequestSetupPanel
                title="HR & payroll"
                desc={`Sync your team's records and payroll with your HR system. Connecting a provider needs its API credentials enabled for ${gym.name} — request setup and our team will switch it on.`}
                items={HR_INTEG}
                icon={Plug}
                gymName={gym.name}
                gymSlug={gym.slug}
              />
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

import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { GymQrCode } from './gym-qr-code';
import { ButtonLink } from '@/components/ui/button';
import {
  Edit3, Banknote, CreditCard, MessageCircle, Mail, BarChart3, Building2,
  Palette, Clock, Bell, Plug, UsersRound, QrCode, ArrowRight,
} from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const checkinUrl = `https://${gym.slug}.gymflow.ng/checkin?g=${gym.id}`;
  const joinUrl = `https://${gym.slug}.gymflow.ng/join`;

  // Reflect what's actually configured. paystack_subaccount_code presence is a
  // good proxy for "Paystack connected"; the platform sends email via Resend
  // and WhatsApp via Termii from the platform side, so those read as connected
  // for any gym unless a future toggle disables them per-tenant.
  const paystackConnected = Boolean(gym.paystack_subaccount_code);

  // Team — surface the live staff roster so the Team section reflects reality
  // rather than the prototype's mock list. Full management still lives on
  // /admin/instructors.
  const supabase = await createClient();
  const { count: staffTotal } = await supabase
    .from('gym_staff_links')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', gym.id)
    .eq('is_active', true);

  // Subnav entries — order matches revamp/admin-settings.html exactly, plus
  // QR codes + Payouts at the end (real backend features the prototype omits).
  const NAV = [
    { id: 'gym-profile',    label: 'Gym profile',    icon: Building2 },
    { id: 'branding',       label: 'Branding',       icon: Palette },
    { id: 'business-hours', label: 'Business hours', icon: Clock },
    { id: 'notifications',  label: 'Notifications',  icon: Bell },
    { id: 'integrations',   label: 'Integrations',   icon: Plug },
    { id: 'team',           label: 'Team',           icon: UsersRound },
    { id: 'qr-codes',       label: 'QR codes',       icon: QrCode },
    { id: 'payouts',        label: 'Payouts',        icon: Banknote },
  ];

  const sectStyle = { marginBottom: 16, scrollMarginTop: 88 } as const;

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Settings</h1>
          <p>{gym.name} · manage your gym, branding and integrations</p>
        </div>
      </div>

      {/* Prototype .set-wrap: sticky 220px subnav (left) + content (right).
          Anchor-based — every section renders and the subnav scroll-jumps,
          so refresh/bookmark/back-button all work without client JS. */}
      <div className="set-wrap">
        <nav className="subnav" aria-label="Settings sections">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <a key={n.id} href={`#${n.id}`}>
                <Icon strokeWidth={1.75} />
                {n.label}
              </a>
            );
          })}
        </nav>

        <div>
          {/* ── Gym profile ── */}
          <section id="gym-profile" className="panel" style={sectStyle}>
            <div className="panel-title">Gym profile</div>
            <div className="panel-desc">Public details shown to members on your subdomain.</div>
            <div className="set-row">
              <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
                <Building2 size={18} strokeWidth={1.75} />
              </span>
              <div className="m">
                <strong>{gym.name}</strong>
                <small>
                  {gym.slug}.gymflow.ng
                  {gym.email ? ` · ${gym.email}` : ''}
                  {gym.phone ? ` · ${gym.phone}` : ''}
                </small>
              </div>
              <ButtonLink href="/admin/settings/landing" variant="primary" size="sm" leadingIcon={<Edit3 size={14} strokeWidth={1.9} />}>
                Edit profile
              </ButtonLink>
            </div>
            {gym.address ? (
              <div className="set-row">
                <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}>
                  <Building2 size={16} strokeWidth={1.75} />
                </span>
                <div className="m">
                  <strong>Address</strong>
                  <small>{gym.address}</small>
                </div>
              </div>
            ) : null}
          </section>

          {/* ── Branding ── */}
          <section id="branding" className="panel" style={sectStyle}>
            <div className="panel-title">Branding</div>
            <div className="panel-desc">
              Customise the landing page members see at{' '}
              <code style={{ background: 'var(--gf-elevated)', padding: '1px 6px', borderRadius: 6 }}>{gym.slug}.gymflow.ng</code>{' '}
              — logo, hero copy, photos, and the landing layout.
            </div>
            <div className="set-row">
              <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
                <Palette size={18} strokeWidth={1.75} />
              </span>
              <div className="m">
                <strong>Landing page editor</strong>
                <small>Hero, gallery, features, and contact strip</small>
              </div>
              <ButtonLink href="/admin/settings/landing" variant="primary" size="sm" leadingIcon={<Edit3 size={14} strokeWidth={1.9} />}>
                Open editor
              </ButtonLink>
            </div>
          </section>

          {/* ── Business hours ── */}
          <section id="business-hours" className="panel" style={sectStyle}>
            <div className="panel-title">Business hours</div>
            <div className="panel-desc">Hours, holiday schedules, and per-room capacity are managed alongside facility operations.</div>
            <div className="set-row">
              <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
                <Clock size={18} strokeWidth={1.75} />
              </span>
              <div className="m">
                <strong>Open hours &amp; facility</strong>
                <small>Zones, equipment status, capacity limits</small>
              </div>
              <ButtonLink href="/admin/operations" variant="primary" size="sm" trailingIcon={<ArrowRight size={14} strokeWidth={1.9} />}>
                Go to Facility
              </ButtonLink>
            </div>
          </section>

          {/* ── Notifications ── */}
          <section id="notifications" className="panel" style={sectStyle}>
            <div className="panel-title">Notifications</div>
            <div className="panel-desc">Automated WhatsApp + email reminders for upcoming class bookings and expiring memberships are configured on the Reminders page.</div>
            <div className="set-row">
              <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
                <Bell size={18} strokeWidth={1.75} />
              </span>
              <div className="m">
                <strong>Reminders &amp; member alerts</strong>
                <small>Class reminders, renewal nudges, send log</small>
              </div>
              <ButtonLink href="/admin/reminders" variant="primary" size="sm" trailingIcon={<ArrowRight size={14} strokeWidth={1.9} />}>
                Go to Reminders
              </ButtonLink>
            </div>
          </section>

          {/* ── Integrations ── */}
          <section id="integrations" className="panel" style={sectStyle}>
            <div className="panel-title">Integrations</div>
            <div className="panel-desc">Connected services powering payments and messaging.</div>
            <div>
              <div className="integ">
                <div className="ig" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
                  <CreditCard size={20} strokeWidth={1.75} />
                </div>
                <div className="m">
                  <strong>Paystack</strong>
                  <small>Subscriptions &amp; auto-debit{paystackConnected ? ' · subaccount configured' : ''}</small>
                </div>
                <span className={`gf-badge ${paystackConnected ? 'gf-badge-success' : 'gf-badge-neutral'}`}>
                  <span className="gf-dot" />
                  {paystackConnected ? 'Connected' : 'Setup'}
                </span>
              </div>
              <div className="integ">
                <div className="ig" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
                  <MessageCircle size={20} strokeWidth={1.75} />
                </div>
                <div className="m">
                  <strong>WhatsApp (Termii)</strong>
                  <small>Reminder &amp; receipt delivery via the platform</small>
                </div>
                <span className="gf-badge gf-badge-success">
                  <span className="gf-dot" />
                  Connected
                </span>
              </div>
              <div className="integ">
                <div className="ig" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}>
                  <Mail size={20} strokeWidth={1.75} />
                </div>
                <div className="m">
                  <strong>Email (Resend)</strong>
                  <small>Transactional email via the platform</small>
                </div>
                <span className="gf-badge gf-badge-success">
                  <span className="gf-dot" />
                  Connected
                </span>
              </div>
              <div className="integ">
                <div className="ig" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-muted)' }}>
                  <BarChart3 size={20} strokeWidth={1.75} />
                </div>
                <div className="m">
                  <strong>PostHog</strong>
                  <small>Product analytics</small>
                </div>
                <span className="gf-badge gf-badge-neutral">
                  <span className="gf-dot" />
                  Optional
                </span>
              </div>
            </div>
          </section>

          {/* ── Team ── */}
          <section id="team" className="panel" style={sectStyle}>
            <div className="panel-title">Team</div>
            <div className="panel-desc">Staff members with admin or instructor access at {gym.name}.</div>
            <div className="set-row">
              <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
                <UsersRound size={18} strokeWidth={1.75} />
              </span>
              <div className="m">
                <strong>{staffTotal ?? 0} active staff member{(staffTotal ?? 0) === 1 ? '' : 's'}</strong>
                <small>Invite instructors, set roles, manage payouts per coach</small>
              </div>
              <ButtonLink href="/admin/instructors" variant="primary" size="sm" trailingIcon={<ArrowRight size={14} strokeWidth={1.9} />}>
                Manage staff
              </ButtonLink>
            </div>
          </section>

          {/* ── QR codes (real feature, additive vs prototype) ── */}
          <section id="qr-codes" className="panel" style={sectStyle}>
            <div className="panel-title">QR codes</div>
            <div className="panel-desc">Print and share these to onboard members and run check-in.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start', marginBottom: 24 }}>
              <GymQrCode value={checkinUrl} downloadName={`${gym.slug}-checkin-qr`} />
              <div>
                <strong style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.95rem' }}>Gym entrance</strong>
                <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--gf-text-secondary)' }}>
                  <strong style={{ color: 'var(--gf-text)' }}>This code never changes</strong> — it encodes only your
                  gym&apos;s id. No member data is exposed.
                </p>
                <p style={{ margin: '12px 0 4px', fontSize: 13, color: 'var(--gf-text-muted)' }}>Payload:</p>
                <p style={{ margin: 0, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: 'var(--gf-text)', wordBreak: 'break-all' }}>
                  {checkinUrl}
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>
              <GymQrCode value={joinUrl} downloadName={`${gym.slug}-signup-qr`} />
              <div>
                <strong style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.95rem' }}>Signup</strong>
                <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--gf-text-secondary)' }}>
                  Use this on flyers, banners, and social posts to take prospects straight to your gym&apos;s sign-up form.
                </p>
              </div>
            </div>
          </section>

          {/* ── Payouts (real feature, additive vs prototype) ── */}
          <section id="payouts" className="panel" style={sectStyle}>
            <div className="panel-title">Payouts</div>
            <div className="panel-desc">Connect your bank so member payments split into your account automatically (minus platform commission).</div>
            <div className="set-row">
              <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
                <Banknote size={18} strokeWidth={1.75} />
              </span>
              <div className="m">
                <strong>Bank settlement</strong>
                <small>{paystackConnected ? 'Paystack subaccount configured' : 'Not configured — payouts go to GymFlow until connected'}</small>
              </div>
              <ButtonLink href="/admin/settings/payouts" variant="primary" size="sm" leadingIcon={<Banknote size={14} strokeWidth={1.9} />}>
                Manage payouts
              </ButtonLink>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

import { requireStaff } from '@/lib/auth/gym';
import { GymQrCode } from './gym-qr-code';
import { ButtonLink } from '@/components/ui/button';
import {
  Edit3, Banknote, CreditCard, MessageCircle, Mail, BarChart3, Building2,
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

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Settings</h1>
          <p>{gym.name} · manage your gym, branding and integrations</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Gym profile</div>
        <div className="panel-desc">Public details shown to members on your subdomain.</div>
        <div className="set-row">
          <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
            <Building2 size={18} strokeWidth={1.75} />
          </span>
          <div className="m">
            <strong>{gym.name}</strong>
            <small>{gym.slug}.gymflow.ng</small>
          </div>
          <ButtonLink href="/admin/settings/landing" variant="primary" size="sm" leadingIcon={<Edit3 size={14} strokeWidth={1.9} />}>
            Edit landing
          </ButtonLink>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">Gym entrance QR code</div>
        <div className="panel-desc">Print this and post it at the gym entrance. Members scan it from the PWA to check in.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>
          <GymQrCode value={checkinUrl} downloadName={`${gym.slug}-checkin-qr`} />
          <div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--gf-text-secondary)' }}>
              <strong style={{ color: 'var(--gf-text)' }}>This code never changes</strong> — it encodes only your
              gym&apos;s id. No member data is exposed.
            </p>
            <p style={{ margin: '12px 0 4px', fontSize: 13, color: 'var(--gf-text-muted)' }}>Payload:</p>
            <p style={{ margin: 0, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: 'var(--gf-text)', wordBreak: 'break-all' }}>
              {checkinUrl}
            </p>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">Signup QR code</div>
        <div className="panel-desc">Use this on flyers, banners, and social posts to take prospects straight to your gym&apos;s sign-up form.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>
          <GymQrCode value={joinUrl} downloadName={`${gym.slug}-signup-qr`} />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--gf-text-secondary)' }}>
            Scanning takes prospective members straight to the join page for {gym.name}.
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
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
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
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
      </div>
    </div>
  );
}

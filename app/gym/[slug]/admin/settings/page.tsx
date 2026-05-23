import { requireStaff } from '@/lib/auth/gym';
import { GymQrCode } from './gym-qr-code';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const checkinUrl = `https://${gym.slug}.gymflow.ng/checkin?g=${gym.id}`;

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Settings</h1>
          <p className="gf-page-subtitle">{gym.name}</p>
        </div>
      </header>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Public landing page</h2>
          <a href="/admin/settings/landing" className="gf-btn gf-btn-primary gf-btn-sm">
            Edit landing
          </a>
        </header>
        <div style={{ padding: 18, color: 'var(--gf-text-secondary)' }}>
          What people see at <strong style={{ color: 'var(--gf-text)' }}>{gym.slug}.gymflow.ng</strong> before they sign in.
        </div>
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Payouts</h2>
          <a href="/admin/settings/payouts" className="gf-btn gf-btn-primary gf-btn-sm">
            Manage payouts
          </a>
        </header>
        <div style={{ padding: 18, color: 'var(--gf-text-secondary)' }}>
          Connect your bank so member payments split into your account automatically (minus platform commission).
        </div>
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Gym entrance QR code</h2>
        </header>
        <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>
          <GymQrCode value={checkinUrl} downloadName={`${gym.slug}-checkin-qr`} />
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--gf-text-secondary)' }}>
              Print this QR and post it at the gym entrance. Members scan it from their PWA to check in.
              <br />
              <strong style={{ color: 'var(--gf-text)' }}>This code never changes</strong> — it encodes only your
              gym&apos;s id. No member data is exposed.
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--gf-text-muted)' }}>Payload (for debugging):</p>
            <p style={{ margin: '4px 0 0', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: 'var(--gf-text)', wordBreak: 'break-all' }}>
              {checkinUrl}
            </p>
          </div>
        </div>
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Signup QR code</h2>
        </header>
        <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>
          <GymQrCode value={`https://${gym.slug}.gymflow.ng/join`} downloadName={`${gym.slug}-signup-qr`} />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--gf-text-secondary)' }}>
            Use this on flyers, banners, or social posts. Scanning takes prospective members straight to your gym&apos;s
            sign-up form.
          </p>
        </div>
      </section>
    </div>
  );
}

import { requireStaff } from '@/lib/auth/gym';
import { GymQrCode } from './gym-qr-code';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { Edit3, Banknote } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const checkinUrl = `https://${gym.slug}.gymflow.ng/checkin?g=${gym.id}`;

  return (
    <div className="gf-page">
      <PageHeader title="Settings" subtitle={gym.name} />

      <Card>
        <CardHeader
          title="Public landing page"
          action={
            <ButtonLink href="/admin/settings/landing" variant="primary" size="sm" leadingIcon={<Edit3 size={16} strokeWidth={1.75} />}>
              Edit landing
            </ButtonLink>
          }
        />
        <div style={{ padding: 18, color: 'var(--gf-text-secondary)' }}>
          What people see at <strong style={{ color: 'var(--gf-text)' }}>{gym.slug}.gymflow.ng</strong> before they sign in.
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Payouts"
          action={
            <ButtonLink href="/admin/settings/payouts" variant="primary" size="sm" leadingIcon={<Banknote size={16} strokeWidth={1.75} />}>
              Manage payouts
            </ButtonLink>
          }
        />
        <div style={{ padding: 18, color: 'var(--gf-text-secondary)' }}>
          Connect your bank so member payments split into your account automatically (minus platform commission).
        </div>
      </Card>

      <Card>
        <CardHeader title="Gym entrance QR code" />
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
      </Card>

      <Card>
        <CardHeader title="Signup QR code" />
        <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, alignItems: 'start' }}>
          <GymQrCode value={`https://${gym.slug}.gymflow.ng/join`} downloadName={`${gym.slug}-signup-qr`} />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--gf-text-secondary)' }}>
            Use this on flyers, banners, or social posts. Scanning takes prospective members straight to your gym&apos;s
            sign-up form.
          </p>
        </div>
      </Card>
    </div>
  );
}

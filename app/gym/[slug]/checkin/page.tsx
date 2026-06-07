import { requireMember } from '@/lib/auth/gym';
import { SelfCheckInButton } from './self-checkin-button';
import { CheckinQr } from './checkin-qr';

export const metadata = { title: 'Check in' };

type PageProps = { params: Promise<{ slug: string }> };

export default async function CheckInPage({ params }: PageProps) {
  const { slug } = await params;
  const { user } = await requireMember(slug);

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const memberCodeUrl = `${origin}/admin/staff-checkin?member=${encodeURIComponent(user.id)}`;

  return (
    <div className="op-mobile member-portal member-app">
      <header className="m-head" style={{ justifyContent: 'center', paddingBottom: 6 }}>
        <strong className="htitle">Check in</strong>
      </header>

      <div className="m-ci">
        <h2 className="m-ci-title">Scan at the door</h2>
        <p className="m-ci-sub">Show this code at the entrance, or tap to self check-in.</p>
        <CheckinQr value={memberCodeUrl} />
        <SelfCheckInButton slug={slug} />
      </div>
    </div>
  );
}

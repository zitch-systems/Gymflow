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
    <div className="ds-member">
      <div className="view on" data-v="checkin">
        <div className="ci">
          <div className="mhead" style={{ justifyContent: 'center', paddingBottom: 6 }}>
            <strong className="htitle">Check in</strong>
          </div>
          <h2>Scan at the door</h2>
          <p>Show this code at the entrance, or tap to self check-in.</p>
          <CheckinQr value={memberCodeUrl} />
          <div style={{ marginTop: 26 }}>
            <SelfCheckInButton slug={slug} />
          </div>
        </div>
      </div>
    </div>
  );
}

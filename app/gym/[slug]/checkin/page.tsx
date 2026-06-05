import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { SelfCheckInButton } from './self-checkin-button';
import { CheckinQr } from './checkin-qr';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ClipboardList, Check } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function CheckInPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const { data: recent } = await supabase
    .from('check_ins')
    .select('checked_in_at, check_in_method')
    .eq('member_id', user.id)
    .eq('gym_id', gym.id)
    .order('checked_in_at', { ascending: false })
    .limit(5);

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const memberCodeUrl = `${origin}/admin/staff-checkin?member=${encodeURIComponent(user.id)}`;

  return (
    <div className="member-portal member-app">
      <PageHeader title="Check in" subtitle={gym.name} />

      <div className="m-ci">
        <h2 className="m-ci-title">Scan at the door</h2>
        <p className="m-ci-sub">Show this code at the entrance, or tap to self check-in.</p>
        <CheckinQr value={memberCodeUrl} />
        <SelfCheckInButton slug={slug} />
        <details className="m-ci-fallback">
          <summary>Can&apos;t scan? Enter the code manually</summary>
          <p className="gf-form-hint" style={{ marginTop: 8 }}>Show this member code to the front desk:</p>
          <code className="m-ci-code">{user.id}</code>
        </details>
      </div>

      <div className="m-sect-t" style={{ marginTop: 4 }}>Recent check-ins</div>
      {recent && recent.length > 0 ? (
        <div className="m-links">
          {recent.map((c, i) => (
            <div key={`${c.checked_in_at}-${i}`} className="m-lc">
              <span className="m-lc-ic"><Check size={18} strokeWidth={2} /></span>
              <span className="m-lc-m">
                <strong>{c.check_in_method === 'self' ? 'QR self check-in' : c.check_in_method === 'staff' ? 'Front desk' : 'Check-in'}</strong>
                <small>{fmtDateTime(c.checked_in_at)}</small>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={ClipboardList} title="No visits yet" message="Your check-in history will appear here." />
        </Card>
      )}
    </div>
  );
}

import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { SelfCheckInButton } from './self-checkin-button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ClipboardList } from 'lucide-react';

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
    <div className="gf-page">
      <PageHeader title="Check in" subtitle={gym.name} />

      <div className="gf-card checkin-card">
        <p className="checkin-help">
          Point your camera at the gym&apos;s QR code, or show this code to the front desk.
        </p>
        <div className="checkin-code">
          <div className="checkin-code-label">Your member code</div>
          <div className="checkin-code-value">{user.id}</div>
          <noscript>
            <p className="gf-form-hint">If JavaScript is disabled, the front desk can enter this ID manually.</p>
          </noscript>
          <p className="gf-form-hint">{memberCodeUrl}</p>
        </div>
        <SelfCheckInButton slug={slug} />
      </div>

      <Card>
        <CardHeader title="Recent visits" />
        {recent && recent.length > 0 ? (
          <ul className="gf-list">
            {recent.map((c, i) => (
              <li key={`${c.checked_in_at}-${i}`} className="gf-list-row">
                <span>{fmtDateTime(c.checked_in_at)}</span>
                <span className="gf-table-meta">{c.check_in_method ?? '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ClipboardList} title="No visits yet" message="Your check-in history will appear here." />
        )}
      </Card>
    </div>
  );
}

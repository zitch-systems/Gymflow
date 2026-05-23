import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { SelfCheckInButton } from './self-checkin-button';

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
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Check in</h1>
          <p className="gf-page-subtitle">{gym.name}</p>
        </div>
      </header>

      <div className="gf-card checkin-card">
        <p className="checkin-help">
          Tap below to check yourself in, or show this code to the front desk.
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

      <div className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Recent visits</h2>
        </header>
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
          <div className="gf-empty">
            <div className="gf-empty-icon">📋</div>
            <div className="gf-empty-title">No visits yet</div>
            <div className="gf-empty-text">Your check-in history will appear here.</div>
          </div>
        )}
      </div>
    </div>
  );
}

import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function MemberDashboard({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);
  const profile = await getProfile();

  const supabase = await createClient();
  const { data: subscription } = await supabase
    .from('member_subscriptions')
    .select('*')
    .eq('member_id', user.id)
    .eq('gym_id', gym.id)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const remaining = subscription ? daysLeft(subscription.end_date) : 0;
  const isActive = remaining > 0;

  return (
    <div className="member-portal">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">{gym.name}</h1>
          <p className="gf-page-subtitle">Member Portal</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm">
            Sign out
          </button>
        </form>
      </header>

      <div className={`status-card ${isActive ? 'is-active' : 'is-inactive'}`}>
        <div className="status-card-header">
          <span className={`status-pill ${isActive ? 'on' : 'off'}`}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
          <span className="status-card-meta">{slug}.gymflow.ng</span>
        </div>
        <div className="status-card-value">{remaining}</div>
        <div className="status-card-label">days remaining</div>
        {subscription && (
          <div className="status-card-due">Next due: {fmtDate(subscription.end_date)}</div>
        )}
      </div>

      <section className="member-quick-actions">
        <Link href="/checkin" className="gf-quick-action">
          <span aria-hidden>📷</span>
          <span>Check In</span>
        </Link>
        <Link href="/classes" className="gf-quick-action">
          <span aria-hidden>📅</span>
          <span>Classes</span>
        </Link>
        <Link href="/dashboard/renew" className="gf-quick-action">
          <span aria-hidden>💳</span>
          <span>Renew</span>
        </Link>
        <Link href="/dashboard/history" className="gf-quick-action">
          <span aria-hidden>💰</span>
          <span>History</span>
        </Link>
      </section>

      <div className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Your profile</h2>
        </header>
        <dl className="gf-detail-list">
          <div>
            <dt>Name</dt>
            <dd>{profile?.full_name ?? '—'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{profile?.email ?? user.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{profile?.phone ?? '—'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

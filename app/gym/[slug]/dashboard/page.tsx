import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { SubscriptionActions } from './subscription-actions';
import { QuickAction } from '@/components/ui/quick-action';
import { Card, CardHeader } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ScanLine, CalendarDays, GraduationCap, CreditCard, Wallet, LogOut } from 'lucide-react';

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
      <PageHeader
        title={gym.name}
        subtitle="Member Portal"
        actions={
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={16} strokeWidth={1.75} />}>
              Sign out
            </Button>
          </form>
        }
      />

      <div className={`status-card ${isActive ? 'is-active' : 'is-inactive'}`}>
        <div className="status-card-header">
          <StatusPill tone={isActive ? 'on' : 'off'}>{isActive ? 'Active' : 'Inactive'}</StatusPill>
          <span className="status-card-meta">{slug}.gymflow.ng</span>
        </div>
        <div className="status-card-value">{remaining}</div>
        <div className="status-card-label">days remaining</div>
        {subscription && (
          <div className="status-card-due">Next due: {fmtDate(subscription.end_date)}</div>
        )}
      </div>

      <section className="member-quick-actions">
        <QuickAction href="/checkin" icon={ScanLine} label="Check In" />
        <QuickAction href="/classes" icon={CalendarDays} label="Classes" />
        <QuickAction href="/dashboard/instructors" icon={GraduationCap} label="Instructors" />
        <QuickAction href="/dashboard/renew" icon={CreditCard} label="Renew" />
        <QuickAction href="/dashboard/cards" icon={Wallet} label="Saved cards" />
      </section>

      {subscription && (
        <Card>
          <CardHeader title="Manage subscription" />
          <div style={{ padding: 18 }}>
            <SubscriptionActions
              slug={slug}
              status={subscription.status ?? 'active'}
              autoRenew={!!subscription.auto_debit_enabled}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Your profile" />
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
      </Card>
    </div>
  );
}

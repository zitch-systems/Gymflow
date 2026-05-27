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
import { computeActivity, findNextClass, type ScheduleRow } from '@/lib/activity';
import { daysAgoIso } from '@/lib/dates';
import { ScanLine, CalendarDays, GraduationCap, CreditCard, Wallet, LogOut, Flame, MapPin, Clock } from 'lucide-react';

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

  const [{ data: checkIns }, { data: schedules }] = await Promise.all([
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .gte('checked_in_at', daysAgoIso(45))
      .order('checked_in_at', { ascending: false }),
    supabase
      .from('class_schedules')
      .select('day_of_week, start_time, end_time, room, classes(name, instructor)')
      .eq('gym_id', gym.id)
      .eq('is_active', true),
  ]);

  const activity = computeActivity((checkIns ?? []).map((c) => c.checked_in_at));
  const nextClass = findNextClass((schedules ?? []) as unknown as ScheduleRow[]);

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
        <QuickAction href="/dashboard/instructors" icon={GraduationCap} label="Coaches" />
        <QuickAction href="/dashboard/renew" icon={CreditCard} label="Renew" />
        <QuickAction href="/dashboard/cards" icon={Wallet} label="Cards" />
      </section>

      <div className="member-cards-row">
        <Card>
          <CardHeader title="Your activity" />
          <div className="member-activity">
            <div className="member-activity-stats">
              <div className="member-activity-stat">
                <span className="member-activity-num">
                  <Flame size={18} strokeWidth={2} className="member-activity-flame" />
                  {activity.currentStreak}
                </span>
                <span className="member-activity-cap">day streak</span>
              </div>
              <div className="member-activity-stat">
                <span className="member-activity-num">{activity.visitsThisMonth}</span>
                <span className="member-activity-cap">this month</span>
              </div>
              <div className="member-activity-stat">
                <span className="member-activity-num">{activity.totalVisits}</span>
                <span className="member-activity-cap">recent visits</span>
              </div>
            </div>
            <div className="member-activity-strip" aria-hidden>
              {activity.strip.map((d) => (
                <span
                  key={d.date}
                  className={`member-activity-dot${d.active ? ' active' : ''}`}
                  title={d.date}
                />
              ))}
            </div>
            <p className="member-activity-hint">
              {activity.lastVisit
                ? `Last visit ${fmtDate(activity.lastVisit)}`
                : 'No check-ins yet — scan the gym QR to log your first visit.'}
            </p>
          </div>
        </Card>

        {nextClass && (
          <Card>
            <CardHeader title="Next class" />
            <div className="member-nextclass">
              <div className="member-nextclass-name">{nextClass.name}</div>
              <div className="member-nextclass-when">
                <span className={`gf-badge ${nextClass.isToday ? 'gf-badge-accent' : 'gf-badge-brand'}`}>
                  {nextClass.dayLabel}
                </span>
                <span className="member-nextclass-meta">
                  <Clock size={14} strokeWidth={1.75} /> {nextClass.start}–{nextClass.end}
                </span>
                {nextClass.room && (
                  <span className="member-nextclass-meta">
                    <MapPin size={14} strokeWidth={1.75} /> {nextClass.room}
                  </span>
                )}
              </div>
              {nextClass.instructor && (
                <div className="member-nextclass-coach">with {nextClass.instructor}</div>
              )}
              <a href="/classes" className="gf-btn gf-btn-secondary gf-btn-sm" style={{ marginTop: 12 }}>
                View timetable
              </a>
            </div>
          </Card>
        )}
      </div>

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

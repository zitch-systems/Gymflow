import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, greeting, firstName } from '@/lib/format';
import { SubscriptionActions } from './subscription-actions';
import { QuickAction } from '@/components/ui/quick-action';
import { Card, CardHeader } from '@/components/ui/card';
import { computeActivity, findNextClass, type ScheduleRow } from '@/lib/activity';
import { daysAgoIso } from '@/lib/dates';
import { ScanLine, CalendarDays, GraduationCap, CreditCard, Wallet, Flame, MapPin, Clock, Settings, ChevronRight, Dumbbell } from 'lucide-react';

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

  // PT-pack credits the member holds at this gym. RLS on pt_pack_credits
  // restricts SELECT to the row owner, so this read works via the user
  // client without leaking other members' balances.
  const { data: ptCreditsRaw } = await supabase
    .from('pt_pack_credits' as never)
    .select('id, instructor_id, sessions_total, sessions_used, purchased_at')
    .eq('gym_id' as never, gym.id)
    .eq('member_id' as never, user.id)
    .order('purchased_at' as never, { ascending: true });
  const ptCredits = ((ptCreditsRaw ?? []) as unknown as Array<{
    id: string;
    instructor_id: string;
    sessions_total: number;
    sessions_used: number;
    purchased_at: string;
  }>).filter((c) => c.sessions_used < c.sessions_total);
  const ptInstructorIds = [...new Set(ptCredits.map((c) => c.instructor_id))];
  const { data: ptInstructorProfiles } = ptInstructorIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, last_name').in('id', ptInstructorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null }> };
  const ptCoachLabel = new Map((ptInstructorProfiles ?? []).map((p) => [
    p.id,
    p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? 'Coach',
  ] as const));

  // Is there at least one active PT pack on offer at this gym? Used to decide
  // whether to surface a "Browse PT packs" CTA in the dashboard widget — no
  // point linking to an empty page. head:true returns a count without rows.
  const { count: ptPackOfferCount } = await supabase
    .from('pt_packs' as never)
    .select('id', { count: 'exact', head: true })
    .eq('gym_id' as never, gym.id)
    .eq('is_active' as never, true);
  const ptPacksAvailable = (ptPackOfferCount ?? 0) > 0;

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

  const memberName = firstName(profile?.full_name ?? profile?.first_name);
  const avatarInitial = (profile?.full_name ?? profile?.email ?? user.email ?? 'M').charAt(0).toUpperCase();

  return (
    <div className="member-portal app-shell">
      {/* App-style greeting header with avatar */}
      <header className="app-greeting">
        <div>
          <p className="app-greeting-hi">{greeting()},</p>
          <h1 className="app-greeting-name">{memberName} 👋</h1>
        </div>
        <Link href="/dashboard/profile" className="app-avatar" aria-label="Profile & settings">
          {profile?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" />
          ) : (
            <span>{avatarInitial}</span>
          )}
        </Link>
      </header>

      {/* Membership card — the hero, styled like a physical gym card */}
      <div className={`member-card ${isActive ? 'is-active' : 'is-inactive'}`}>
        <div className="member-card-shine" aria-hidden />
        <div className="member-card-top">
          <span className="member-card-gym">{gym.name}</span>
          <span className={`member-card-badge ${isActive ? 'on' : 'off'}`}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="member-card-body">
          <div className="member-card-days">
            <span className="member-card-days-num">{remaining}</span>
            <span className="member-card-days-cap">day{remaining === 1 ? '' : 's'} left</span>
          </div>
          {subscription ? (
            <div className="member-card-meta">Renews {fmtDate(subscription.end_date)}</div>
          ) : (
            <div className="member-card-meta">No active plan</div>
          )}
        </div>
        <div className="member-card-foot">
          <span className="member-card-name">{profile?.full_name ?? user.email}</span>
          {!isActive && (
            <Link href="/dashboard/renew" className="member-card-cta">Renew now</Link>
          )}
        </div>
      </div>

      {/* Primary action — big scan button, the #1 member task */}
      <Link href="/checkin" className="app-primary-action">
        <span className="app-primary-action-icon"><ScanLine size={22} strokeWidth={2} /></span>
        <span className="app-primary-action-text">
          <strong>Check in</strong>
          <small>Scan the gym QR to log your visit</small>
        </span>
        <ChevronRight size={20} strokeWidth={2} className="app-primary-action-chev" />
      </Link>

      {/* App tile grid */}
      <section className="app-tiles">
        <QuickAction href="/classes" icon={CalendarDays} label="Classes" />
        <QuickAction href="/dashboard/instructors" icon={GraduationCap} label="Coaches" />
        <QuickAction href="/dashboard/pt-packs" icon={Dumbbell} label="PT Packs" />
        <QuickAction href="/dashboard/renew" icon={CreditCard} label="Renew" />
        <QuickAction href="/dashboard/cards" icon={Wallet} label="Cards" />
        <QuickAction href="/dashboard/profile" icon={Settings} label="Settings" />
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

      {(ptCredits.length > 0 || ptPacksAvailable) && (
        <Card>
          <CardHeader
            title="Personal training credits"
            action={ptPacksAvailable ? (
              <Link href="/dashboard/pt-packs" style={{ color: 'var(--gf-brand)', fontWeight: 600, textDecoration: 'none', fontSize: 13 }}>
                {ptCredits.length > 0 ? 'Browse more packs →' : 'Browse packs →'}
              </Link>
            ) : null}
          />
          {ptCredits.length > 0 ? (
            <ul className="gf-list">
              {ptCredits.map((c) => {
                const remaining = c.sessions_total - c.sessions_used;
                return (
                  <li key={c.id} className="gf-list-row">
                    <span>
                      <strong>{remaining}</strong> session{remaining === 1 ? '' : 's'} left
                      <span className="gf-table-meta"> · with {ptCoachLabel.get(c.instructor_id) ?? 'Coach'}</span>
                    </span>
                    <span className="gf-table-meta">{c.sessions_used} of {c.sessions_total} used</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div style={{ padding: 18, fontSize: 14, color: 'var(--gf-text-secondary)' }}>
              Train one-on-one with a coach — buy a session pack and book whenever you&apos;re ready.
            </div>
          )}
        </Card>
      )}

    </div>
  );
}

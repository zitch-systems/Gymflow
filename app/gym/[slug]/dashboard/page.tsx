import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { SubscriptionActions } from './subscription-actions';
import { Card, CardHeader } from '@/components/ui/card';
import { computeActivity, findNextClass, type ScheduleRow } from '@/lib/activity';
import { daysAgoIso } from '@/lib/dates';
import { Bell, ScanLine, CalendarDays, GraduationCap, CreditCard, Wallet, Flame, MapPin, Clock, Settings, ChevronRight, Dumbbell } from 'lucide-react';

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

  const [{ data: checkIns }, { data: schedules }, { count: unreadCountRaw }] = await Promise.all([
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
    // Inbox bell badge — head:true returns a count without rows so we don't
    // pay the bytes for an unused list. RLS scopes to the caller's own rows.
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('gym_id', gym.id)
      .eq('is_read', false),
  ]);
  const unreadCount = unreadCountRaw ?? 0;

  const activity = computeActivity((checkIns ?? []).map((c) => c.checked_in_at));
  const nextClass = findNextClass((schedules ?? []) as unknown as ScheduleRow[]);

  const memberName = firstName(profile?.full_name ?? profile?.first_name);
  const avatarInitial = (profile?.full_name ?? profile?.email ?? user.email ?? 'M').charAt(0).toUpperCase();

  // Progress bar: how much of the current billing period is used. The design
  // system's status card shows a volt-lime fill of "days used vs left".
  let pctUsed = 0;
  let daysUsed = 0;
  if (subscription?.end_date && subscription?.start_date) {
    const start = new Date(subscription.start_date).getTime();
    const end = new Date(subscription.end_date).getTime();
    // Server component, request-scoped — current time is legitimately
    // request state, not a purity violation.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (end > start) {
      pctUsed = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
      daysUsed = Math.max(0, Math.round((now - start) / 86_400_000));
    }
  }

  return (
    <div className="member-portal member-app">
      {/* Greeting header — gym name (small) over "Hi, {name} 👋" + avatar.
          Matches the design-system member.html .mhead pattern. */}
      <header className="m-head">
        <Link href="/dashboard/profile" className="m-head-avatar" aria-label="Profile & settings">
          {profile?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" />
          ) : (
            <span>{avatarInitial}</span>
          )}
        </Link>
        <div className="m-head-text">
          <small>{gym.name}</small>
          <strong>Hi, {memberName} 👋</strong>
        </div>
        <Link href="/dashboard/inbox" className="m-head-bell" aria-label={unreadCount > 0 ? `Inbox · ${unreadCount} unread` : 'Inbox'}>
          <Bell size={18} strokeWidth={1.9} />
          {unreadCount > 0 ? (
            <span className="m-head-bell-badge" aria-hidden>{unreadCount > 99 ? '99+' : unreadCount}</span>
          ) : null}
        </Link>
      </header>

      {/* Membership status card — gradient, progress bar (days used / left). */}
      <div className="m-status">
        <span className="m-status-tag">
          <span className="m-status-dot" aria-hidden />
          {isActive ? 'Active' : subscription ? 'Expired' : 'No plan'}
        </span>
        <div className="m-status-plan">{isActive ? `${remaining} day${remaining === 1 ? '' : 's'} left` : subscription ? 'Membership expired' : 'No active membership'}</div>
        <div className="m-status-meta">
          {subscription ? `Renews ${fmtDate(subscription.end_date)}` : 'Renew to start training'}
        </div>
        {subscription && (
          <>
            <div className="m-status-barwrap"><div className="m-status-bar" style={{ width: `${pctUsed}%` }} /></div>
            <div className="m-status-days">
              <span>{daysUsed} days used</span>
              <span>{remaining} days left</span>
            </div>
          </>
        )}
        {!isActive && (
          <Link href="/dashboard/renew" className="gf-btn gf-btn-light gf-btn-sm m-status-renew">Renew membership</Link>
        )}
      </div>

      {/* Quick actions — 3-up, icon-over-label (design-system .qa). */}
      <section className="m-qa">
        <Link href="/checkin" className="m-qa-tile"><ScanLine /> Check in</Link>
        <Link href="/classes" className="m-qa-tile"><CalendarDays /> Book class</Link>
        <Link href="/dashboard/renew" className="m-qa-tile"><CreditCard /> Renew</Link>
      </section>

      {/* Secondary destinations — compact list cards. */}
      <div className="m-sect-t">More</div>
      <section className="m-links">
        <Link href="/dashboard/instructors" className="m-lc">
          <span className="m-lc-ic"><GraduationCap size={18} strokeWidth={1.9} /></span>
          <span className="m-lc-m"><strong>Coaches</strong><small>Browse & subscribe</small></span>
          <ChevronRight size={18} strokeWidth={1.9} className="m-lc-chev" />
        </Link>
        <Link href="/dashboard/pt-packs" className="m-lc">
          <span className="m-lc-ic"><Dumbbell size={18} strokeWidth={1.9} /></span>
          <span className="m-lc-m"><strong>Personal training</strong><small>Buy & track session packs</small></span>
          <ChevronRight size={18} strokeWidth={1.9} className="m-lc-chev" />
        </Link>
        <Link href="/dashboard/cards" className="m-lc">
          <span className="m-lc-ic"><Wallet size={18} strokeWidth={1.9} /></span>
          <span className="m-lc-m"><strong>Saved cards</strong><small>Manage payment methods</small></span>
          <ChevronRight size={18} strokeWidth={1.9} className="m-lc-chev" />
        </Link>
        <Link href="/dashboard/profile" className="m-lc">
          <span className="m-lc-ic"><Settings size={18} strokeWidth={1.9} /></span>
          <span className="m-lc-m"><strong>Settings</strong><small>Profile, notifications, password</small></span>
          <ChevronRight size={18} strokeWidth={1.9} className="m-lc-chev" />
        </Link>
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

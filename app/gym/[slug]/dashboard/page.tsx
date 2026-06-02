import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { computeActivity, findNextClass, type ScheduleRow } from '@/lib/activity';
import { daysAgoIso } from '@/lib/dates';
import { Bell, ScanLine, CalendarDays, CreditCard, Flame, ChevronRight, Dumbbell, Wallet } from 'lucide-react';

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
  // Does the member hold any unused PT-pack sessions? Only the count matters
  // here — the dashboard's PT chip shows a "New" badge to non-holders. Full
  // balances + coaches live on the PT-packs page.
  const { data: ptCreditsRaw } = await supabase
    .from('pt_pack_credits' as never)
    .select('sessions_total, sessions_used')
    .eq('gym_id' as never, gym.id)
    .eq('member_id' as never, user.id);
  const ptCredits = ((ptCreditsRaw ?? []) as unknown as Array<{
    sessions_total: number;
    sessions_used: number;
  }>).filter((c) => c.sessions_used < c.sessions_total);

  // Is there at least one active PT pack on offer at this gym? Used to decide
  // whether to surface the "New" badge on the PT chip — no point nudging
  // toward an empty page. head:true returns a count without rows.
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
    <div className="member-portal member-app m-dash">
      {/* Greeting header — gym name (small) over "Hi, {name} 👋" + avatar. */}
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

      {/* Quick actions — 5-up circular icon chips. These deliberately surface
          actions/destinations the bottom tab bar does NOT (PT packs, Saved
          cards, Inbox) plus the two primary actions (Check in, Renew); Classes
          and Coaches already live in the tab bar, so they're not duplicated. */}
      <div className="m-group">
        <section className="m-circ-row" aria-label="Quick actions">
          <Link href="/checkin" className="m-circ">
            <span className="m-circ-ic"><ScanLine /></span>
            <span className="m-circ-label">Check in</span>
          </Link>
          <Link href="/dashboard/pt-packs" className="m-circ">
            <span className="m-circ-ic"><Dumbbell /></span>
            <span className="m-circ-label">PT packs</span>
            {ptPacksAvailable && ptCredits.length === 0 ? <span className="m-circ-badge" aria-hidden>New</span> : null}
          </Link>
          <Link href="/dashboard/cards" className="m-circ">
            <span className="m-circ-ic"><Wallet /></span>
            <span className="m-circ-label">Cards</span>
          </Link>
          <Link href="/dashboard/inbox" className="m-circ">
            <span className="m-circ-ic"><Bell /></span>
            <span className="m-circ-label">Inbox</span>
            {unreadCount > 0 ? <span className="m-circ-badge" aria-hidden>{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
          </Link>
          <Link href="/dashboard/renew" className="m-circ">
            <span className="m-circ-ic"><CreditCard /></span>
            <span className="m-circ-label">Renew</span>
            {!isActive ? <span className="m-circ-badge" aria-hidden>Due</span> : null}
          </Link>
        </section>
      </div>

      {/* Activity at a glance — 3-up strip (streak / this month / recent). */}
      <section className="m-stats" aria-label="Your activity">
        <div className="m-stat">
          <span className="m-stat-num">
            <Flame strokeWidth={2} className="m-stat-flame" />
            {activity.currentStreak}
          </span>
          <span className="m-stat-cap">day streak</span>
        </div>
        <div className="m-stat">
          <span className="m-stat-num">{activity.visitsThisMonth}</span>
          <span className="m-stat-cap">this month</span>
        </div>
        <div className="m-stat">
          <span className="m-stat-num">{activity.totalVisits}</span>
          <span className="m-stat-cap">recent visits</span>
        </div>
      </section>

      {/* Next class — one slim row that deep-links to the timetable. */}
      {nextClass ? (
        <Link href="/classes" className="m-next">
          <span className="m-next-ic"><CalendarDays size={18} strokeWidth={1.9} /></span>
          <span className="m-next-m">
            <strong>{nextClass.name}</strong>
            <small>
              {nextClass.start}–{nextClass.end}
              {nextClass.room ? ` · ${nextClass.room}` : ''}
              {nextClass.instructor ? ` · ${nextClass.instructor}` : ''}
            </small>
          </span>
          <span className={`gf-badge ${nextClass.isToday ? 'gf-badge-accent' : 'gf-badge-brand'} m-next-when`}>
            {nextClass.dayLabel}
          </span>
        </Link>
      ) : (
        <Link href="/checkin" className="m-next">
          <span className="m-next-ic"><ScanLine size={18} strokeWidth={1.9} /></span>
          <span className="m-next-m">
            <strong>{activity.lastVisit ? `Last visit ${fmtDate(activity.lastVisit)}` : 'No check-ins yet'}</strong>
            <small>Scan the gym QR to log a visit</small>
          </span>
          <ChevronRight size={18} strokeWidth={1.9} className="m-lc-chev" />
        </Link>
      )}
    </div>
  );
}

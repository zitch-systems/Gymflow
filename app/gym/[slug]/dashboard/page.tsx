import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { computeActivity, findNextClass, type ScheduleRow } from '@/lib/activity';
import { daysAgoIso } from '@/lib/dates';
import { Bell, ScanLine, CalendarDays, Wallet, QrCode, Flame, Activity, CalendarCheck, Check, CreditCard, ChevronRight } from 'lucide-react';

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

  // Membership progress (days used vs left in the current period).
  let pctUsed = 0;
  let daysUsed = 0;
  if (subscription?.end_date && subscription?.start_date) {
    const start = new Date(subscription.start_date).getTime();
    const end = new Date(subscription.end_date).getTime();
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (end > start) {
      pctUsed = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
      daysUsed = Math.max(0, Math.round((now - start) / 86_400_000));
    }
  }

  // This-week training strip from check-in history (active = trained that day).
  const todayDate = new Date();
  const todayK = todayDate.toISOString().split('T')[0];
  const yesterdayK = new Date(todayDate.getTime() - 86_400_000).toISOString().split('T')[0];
  const activeDays = new Set(activity.strip.filter((d) => d.active).map((d) => d.date));
  const monDow = (todayDate.getUTCDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const mondayMs = Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - monDow);
  const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const weekDays = WEEK_LABELS.map((label, i) => {
    const key = new Date(mondayMs + i * 86_400_000).toISOString().split('T')[0];
    return { label, active: activeDays.has(key), isToday: key === todayK, isFuture: key > todayK, isWeekend: i >= 5 };
  });
  const visitsThisWeek = weekDays.filter((d) => d.active).length;

  // Best streak = longest run of consecutive trained days in the tracked window.
  let bestStreak = 0;
  let run = 0;
  for (const d of activity.strip) {
    if (d.active) { run += 1; bestStreak = Math.max(bestStreak, run); } else { run = 0; }
  }
  bestStreak = Math.max(bestStreak, activity.currentStreak);

  const recentCheckIns = (checkIns ?? [])
    .filter((c): c is { checked_in_at: string } => Boolean(c.checked_in_at))
    .slice(0, 4);
  const checkInDay = (iso: string) => {
    const k = new Date(iso).toISOString().split('T')[0];
    if (k === todayK) return 'Today';
    if (k === yesterdayK) return 'Yesterday';
    return fmtDate(iso);
  };

  return (
    <div className="member-portal member-app m-dash">
      {/* Greeting */}
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
          {unreadCount > 0 ? <span className="m-head-bell-badge" aria-hidden>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
        </Link>
      </header>

      {/* Membership status card */}
      <div className="m-status">
        <span className="m-status-tag">
          <span className="m-status-dot" aria-hidden />
          {isActive ? 'Active' : subscription ? 'Expired' : 'No plan'}
        </span>
        <div className="m-status-plan">
          {isActive ? 'Membership' : subscription ? 'Membership expired' : 'No active membership'}
        </div>
        <div className="m-status-meta">
          {isActive ? `Renews ${fmtDate(subscription!.end_date)}` : subscription ? 'Renew to keep training' : 'Renew to start training'}
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
        <Link href={isActive ? '/dashboard/wallet' : '/dashboard/renew'} className="gf-btn gf-btn-light gf-btn-sm m-status-renew">
          <CreditCard size={15} strokeWidth={2} /> {isActive ? 'Manage membership' : 'Renew membership'}
        </Link>
      </div>

      {/* Quick actions (.qa in the spec — bare on the canvas, no card) */}
      <section className="m-circ-row" aria-label="Quick actions">
        <Link href="/checkin" className="m-circ"><span className="m-circ-ic"><ScanLine /></span><span className="m-circ-label">Check in</span></Link>
        <Link href="/classes" className="m-circ"><span className="m-circ-ic"><CalendarDays /></span><span className="m-circ-label">Schedule</span></Link>
        <Link href="/dashboard/wallet" className="m-circ"><span className="m-circ-ic"><Wallet /></span><span className="m-circ-label">Wallet</span></Link>
        <Link href="/checkin" className="m-circ"><span className="m-circ-ic"><QrCode /></span><span className="m-circ-label">My code</span></Link>
      </section>

      {/* Streak + weekly activity */}
      <section className="m-streakcard" aria-label="This week">
        <div className="m-streak-top">
          <div className="m-streak">
            <span className="m-streak-flame" aria-hidden><Flame strokeWidth={2} /></span>
            <div>
              <b>{activity.currentStreak}-day streak</b>
              <small>Best: {bestStreak} day{bestStreak === 1 ? '' : 's'}</small>
            </div>
          </div>
          <div className="m-streak-goal"><b>{visitsThisWeek}/7</b><small>This week</small></div>
        </div>
        <div className="m-wkdays">
          {weekDays.map((d, i) => (
            <div key={i} className={`m-wkd${d.active ? ' done' : ''}${d.isToday ? ' today' : ''}${d.isWeekend ? ' weekend' : ''}`}>
              <span>{d.label}</span>
              <span className="m-wkd-dot" aria-hidden>{d.active ? <Check size={15} strokeWidth={3} /> : null}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Stat trio — real metrics */}
      <section className="m-stat3" aria-label="Your activity">
        <div className="s"><Activity strokeWidth={1.9} /><b>{activity.visitsThisMonth}</b><small>Visits this month</small></div>
        <div className="s"><CalendarCheck strokeWidth={1.9} /><b>{activity.totalVisits}</b><small>Recent visits</small></div>
        <div className="s"><Flame strokeWidth={1.9} /><b>{bestStreak}</b><small>Best streak</small></div>
      </section>

      {/* Next class */}
      <div className="m-sect-t">Next class<Link href="/classes">See all</Link></div>
      {nextClass ? (
        <Link href="/classes" className="m-next">
          <span className="m-next-ic"><CalendarDays size={18} strokeWidth={1.9} /></span>
          <span className="m-next-m">
            <strong>{nextClass.name}</strong>
            <small>{nextClass.start}–{nextClass.end}{nextClass.room ? ` · ${nextClass.room}` : ''}{nextClass.instructor ? ` · ${nextClass.instructor}` : ''}</small>
          </span>
          <span className={`gf-badge ${nextClass.isToday ? 'gf-badge-accent' : 'gf-badge-brand'} m-next-when`}>{nextClass.dayLabel}</span>
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

      {recentCheckIns.length > 0 && (
        <section className="m-recent" aria-label="Recent check-ins">
          <div className="m-recent-h">Recent check-ins</div>
          {recentCheckIns.map((c, i) => (
            <div key={i} className="m-recent-row">
              <span className="m-recent-ic" aria-hidden><Check size={19} strokeWidth={2.2} /></span>
              <span className="m-recent-m"><strong>Checked in</strong><small>QR scan</small></span>
              <span className="m-recent-t">{checkInDay(c.checked_in_at)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

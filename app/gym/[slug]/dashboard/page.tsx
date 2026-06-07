import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { computeActivity, findNextClass, type ScheduleRow } from '@/lib/activity';
import { daysAgoIso } from '@/lib/dates';
import {
  Bell, ScanLine, CalendarDays, Wallet, QrCode, CreditCard, Flame, Check,
  Activity, CalendarCheck, Timer, Bike, Gift,
} from 'lucide-react';
import { ReferShareButton } from './refer-share-button';

type PageProps = { params: Promise<{ slug: string }> };

// Short day labels for the prototype's weekly grid (M T W T F S S, Mon-anchored).
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

  const memberName = firstName(profile?.full_name ?? profile?.first_name) || 'there';
  const avatarInitial = (profile?.full_name ?? profile?.email ?? user.email ?? 'M').charAt(0).toUpperCase();

  const siteBase = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const referralUrl = `${siteBase}/join?gym=${encodeURIComponent(slug)}`;

  // Membership progress: % of paid period elapsed (drives the .status .bar).
  let pctUsed = 0;
  let daysUsed = 0;
  if (subscription?.end_date && subscription?.start_date) {
    const start = new Date(subscription.start_date).getTime();
    const end = new Date(subscription.end_date).getTime();
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (end > start) pctUsed = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
    daysUsed = Math.max(0, Math.round((now - start) / 86_400_000));
  }

  // Weekly activity grid: which days of THIS week the member checked in.
  const todayDow = new Date().getDay();
  const sunday = new Date();
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const dow = (i + 1) % 7; // Mon..Sun column order
    const target = new Date(sunday);
    target.setDate(sunday.getDate() + dow);
    const targetIso = target.toISOString().split('T')[0];
    return {
      label: DOW_LABELS[dow],
      done: (checkIns ?? []).some((c) => (c.checked_in_at ?? '').startsWith(targetIso)),
      isToday: dow === todayDow,
      isWeekend: dow === 0 || dow === 6,
    };
  });
  const weeklyDone = weekDays.filter((d) => d.done).length;
  const weeklyGoal = weekDays.filter((d) => !d.isWeekend).length;

  return (
    <div className="ds-member">
      <div className="view on" data-v="home">
        {/* ── Greeting header ── */}
        <div className="mhead">
          <Link href="/dashboard/profile" className="gf-avatar gf-avatar-md" aria-label="Profile & settings">
            {avatarInitial}
          </Link>
          <div>
            <small>{gym.name}</small>
            <strong>Hi, {memberName} 👋</strong>
          </div>
          <Link href="/dashboard/inbox" className="icon-btn bell" aria-label={unreadCount > 0 ? `Notifications · ${unreadCount} unread` : 'Notifications'}>
            <Bell strokeWidth={1.75} />
            {unreadCount > 0 && <span className="nub">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </Link>
        </div>

        <div className="home-grid">
          <div className="col-a">
            {/* ── Status card ── */}
            <div className="status">
              <span className="tag">
                <span className="gf-dot" style={{ background: '#fff' }} />
                {isActive ? 'Active' : subscription ? 'Expired' : 'No plan'}
              </span>
              <div className="plan">{isActive ? 'Active membership' : subscription ? 'Membership expired' : 'No active membership'}</div>
              <div className="meta">
                {isActive ? `Renews ${fmtDate(subscription!.end_date)}` : subscription ? 'Renew to keep training' : 'Renew to start training'}
              </div>
              {subscription && (
                <>
                  <div className="barwrap"><div className="bar" style={{ width: `${pctUsed}%` }} /></div>
                  <div className="days">
                    <span>{daysUsed} {daysUsed === 1 ? 'day' : 'days'} used</span>
                    <span>{remaining} {remaining === 1 ? 'day' : 'days'} left</span>
                  </div>
                </>
              )}
              <Link href={isActive ? '/dashboard/wallet' : '/dashboard/renew'} className="status-cta">
                <CreditCard strokeWidth={2} /> {isActive ? 'Manage membership' : 'Renew membership'}
              </Link>
            </div>

            {/* ── Quick actions ── */}
            <div className="qa">
              <Link href="/checkin"><span className="tile"><ScanLine /></span><span>Check in</span></Link>
              <Link href="/classes"><span className="tile"><CalendarDays /></span><span>Schedule</span></Link>
              <Link href="/dashboard/wallet"><span className="tile"><Wallet /></span><span>Wallet</span></Link>
              <Link href="/checkin"><span className="tile"><QrCode /></span><span>My code</span></Link>
            </div>

            {/* ── Weekly streak ── */}
            <div className="week">
              <div className="week-top">
                <div className="week-streak">
                  <span className="flame"><Flame strokeWidth={2} /></span>
                  <div>
                    <b>{activity.currentStreak}-day streak</b>
                    <small>Total {activity.totalVisits} {activity.totalVisits === 1 ? 'visit' : 'visits'}</small>
                  </div>
                </div>
                <div className="week-goal">
                  <b>{weeklyDone}/{weeklyGoal}</b>
                  <small>Weekly goal</small>
                </div>
              </div>
              <div className="week-days">
                {weekDays.map((d, i) => (
                  <div key={i} className={`wd${d.done ? ' done' : ''}${d.isToday ? ' today' : ''}${d.isWeekend ? ' rest' : ''}`}>
                    <span>{d.label}</span>
                    <div className="dot">{d.done && <Check strokeWidth={3} />}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Stat trio ── */}
            <div className="stat3">
              <div className="s"><Activity strokeWidth={1.9} /><b>{activity.visitsThisMonth}</b><small>Visits this month</small></div>
              <div className="s"><CalendarCheck strokeWidth={1.9} /><b>{activity.totalVisits}</b><small>Recent visits</small></div>
              <div className="s"><Timer strokeWidth={1.9} /><b>{activity.currentStreak}<span style={{ fontSize: '0.9rem' }}>d</span></b><small>Day streak</small></div>
            </div>
          </div>

          <div className="col-b">
            {/* ── Next class ── */}
            <div className="sect-t">Next class <Link href="/classes">See all</Link></div>
            {nextClass ? (
              <Link href="/classes" className="lc tap">
                <div className="ic"><Bike /></div>
                <div className="m">
                  <strong>{nextClass.name}</strong>
                  <small>{nextClass.instructor ?? 'TBA'} · {nextClass.start} {nextClass.dayLabel}</small>
                </div>
                <span className="gf-badge gf-badge-success">Booked</span>
              </Link>
            ) : (
              <Link href="/classes" className="lc tap">
                <div className="ic"><CalendarDays /></div>
                <div className="m">
                  <strong>No class booked</strong>
                  <small>Browse the schedule</small>
                </div>
              </Link>
            )}

            {/* ── Refer & earn ── */}
            <div className="promo">
              <span className="pic"><Gift /></span>
              <div className="m">
                <strong>Refer &amp; earn ₦5,000</strong>
                <small>Invite a friend to {gym.name}.</small>
              </div>
              <ReferShareButton gymName={gym.name} signupUrl={referralUrl} className="pill">
                Invite
              </ReferShareButton>
            </div>

            {/* ── Recent check-ins ── */}
            {(checkIns?.length ?? 0) > 0 && (
              <>
                <div className="sect-t">Recent check-ins</div>
                {(checkIns ?? []).slice(0, 3).map((c, i) => (
                  <div key={i} className="lc">
                    <div className="ic"><Check /></div>
                    <div className="m"><strong>Main entrance</strong><small>QR scan</small></div>
                    <span className="t">{fmtDate(c.checked_in_at ?? '')}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

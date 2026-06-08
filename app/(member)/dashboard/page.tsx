import Link from 'next/link';
import {
  Bell, CreditCard, ScanLine, CalendarDays, Wallet, QrCode, Flame, Check,
  Activity, CalendarCheck, Timer, Bike, Gift,
} from 'lucide-react';
import { requireMember, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata = { title: 'Home' };

// Member home — recreates revamp/member.html "home" view. Header, membership
// status card, and recent check-ins are wired to Supabase; the weekly streak +
// stat trio remain sample data pending the activity-aggregation pass.
const WEEK = [
  { d: 'M', done: true }, { d: 'T', done: true }, { d: 'W', done: true, today: true },
  { d: 'T', done: false }, { d: 'F', done: false }, { d: 'S', rest: true }, { d: 'S', rest: true },
];

export default async function MemberHome() {
  const { user, gym } = await requireMember();
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data: sub }, { data: checkIns }, { count: unread }] = await Promise.all([
    supabase
      .from('member_subscriptions')
      .select('status, start_date, end_date, plan_id, membership_plans(name)')
      .eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'active')
      .order('end_date', { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from('check_ins')
      .select('checked_in_at, check_in_method')
      .eq('member_id', user.id).eq('gym_id', gym.id)
      .order('checked_in_at', { ascending: false }).limit(3),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_read', false),
  ]);

  const name = firstName(profile?.full_name ?? profile?.first_name);
  const initial = (profile?.full_name ?? profile?.email ?? user.email ?? 'M').charAt(0).toUpperCase();
  const planName = (sub as unknown as { membership_plans: { name: string } | null })?.membership_plans?.name ?? 'Membership';
  const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
  const isActive = remaining > 0;
  const unreadCount = unread ?? 0;

  return (
    <section className="view on" data-v="home">
      <div className="mhead">
        <span className="gf-avatar gf-avatar-md">{initial}</span>
        <div style={{ flex: 1, minWidth: 0 }}><small>{gym.name}</small><strong>Hi, {name} 👋</strong></div>
        <ThemeToggle size={38} />
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38, marginLeft: 0 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} />{unreadCount > 0 && <span className="nub">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </Link>
      </div>

      <div className="home-grid">
        <div className="col-a">
          <div className="status">
            <span className="tag"><span className="gf-dot" style={{ background: '#fff' }} /> {isActive ? 'Active' : sub ? 'Expired' : 'No plan'}</span>
            <div className="plan">{planName}</div>
            <div className="meta">{isActive ? `Renews ${fmtDate(sub!.end_date)}` : sub ? 'Renew to keep training' : 'No active membership'}</div>
            <div className="barwrap"><div className="bar" /></div>
            <div className="days"><span>{sub?.start_date ? fmtDate(sub.start_date) : '—'}</span><span>{remaining} days left</span></div>
            <Link href={isActive ? '/dashboard/wallet' : '/dashboard/renew'} className="status-cta"><CreditCard strokeWidth={2} /> {isActive ? 'Manage membership' : 'Renew membership'}</Link>
          </div>

          <div className="qa">
            <Link href="/checkin"><span className="tile"><ScanLine strokeWidth={1.9} /></span><span>Check in</span></Link>
            <Link href="/classes"><span className="tile"><CalendarDays strokeWidth={1.9} /></span><span>Schedule</span></Link>
            <Link href="/dashboard/wallet"><span className="tile"><Wallet strokeWidth={1.9} /></span><span>Wallet</span></Link>
            <Link href="/checkin"><span className="tile"><QrCode strokeWidth={1.9} /></span><span>My code</span></Link>
          </div>

          <div className="week">
            <div className="week-top">
              <div className="week-streak">
                <span className="flame"><Flame strokeWidth={2} /></span>
                <div><b>5-day streak</b><small>Best: 9 days</small></div>
              </div>
              <div className="week-goal"><b>3/4</b><small>Weekly goal</small></div>
            </div>
            <div className="week-days">
              {WEEK.map((w, i) => (
                <div key={i} className={`wd${w.done ? ' done' : ''}${w.today ? ' today' : ''}${w.rest ? ' rest' : ''}`}>
                  <span>{w.d}</span>
                  <div className="dot"><Check strokeWidth={3} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="stat3">
            <div className="s"><Activity strokeWidth={1.9} /><b>14</b><small>Visits this month</small></div>
            <div className="s"><CalendarCheck strokeWidth={1.9} /><b>6</b><small>Classes booked</small></div>
            <div className="s"><Timer strokeWidth={1.9} /><b>52<span style={{ fontSize: '0.9rem' }}>m</span></b><small>Avg session</small></div>
          </div>
        </div>

        <div className="col-b">
          <div className="sect-t">Next class <Link href="/classes">See all</Link></div>
          <Link href="/classes" className="lc tap">
            <div className="ic"><Bike strokeWidth={1.9} /></div>
            <div className="m"><strong>Spin Class</strong><small>Coach Tobi · 17:30 today</small></div>
            <span className="gf-badge gf-badge-success">Booked</span>
          </Link>

          <div className="promo">
            <span className="pic"><Gift strokeWidth={1.9} /></span>
            <div className="m"><strong>Refer &amp; earn ₦5,000</strong><small>Invite a friend to Powerhouse.</small></div>
            <button className="pill">Invite</button>
          </div>

          {(checkIns?.length ?? 0) > 0 && (
            <>
              <div className="sect-t">Recent check-ins</div>
              {(checkIns ?? []).map((c, i) => (
                <div className="lc" key={i}>
                  <div className="ic"><Check strokeWidth={1.9} /></div>
                  <div className="m"><strong>Main entrance</strong><small>{c.check_in_method ?? 'QR scan'}</small></div>
                  <span className="t">{fmtDate(c.checked_in_at)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

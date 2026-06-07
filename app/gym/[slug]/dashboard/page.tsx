import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { computeActivity, findNextClass, type ScheduleRow } from '@/lib/activity';
import { daysAgoIso } from '@/lib/dates';
import {
  Bell, ScanLine, CalendarDays, Wallet, QrCode, CreditCard, ChevronRight,
  ShieldCheck, Eye, Plus, ArrowDownLeft, ArrowUpRight, Headphones,
  GraduationCap, Inbox, Activity, Megaphone, Sparkles, UserCircle2,
  Dumbbell, MoreHorizontal, Receipt,
} from 'lucide-react';

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

  const [{ data: checkIns }, { data: schedules }, { count: unreadCountRaw }, { data: recentPayments }] = await Promise.all([
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
    supabase
      .from('payments')
      .select('id, amount, status, created_at, payment_method')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: false })
      .limit(2),
  ]);
  const unreadCount = unreadCountRaw ?? 0;

  const activity = computeActivity((checkIns ?? []).map((c) => c.checked_in_at));
  const nextClass = findNextClass((schedules ?? []) as unknown as ScheduleRow[]);

  const memberName = firstName(profile?.full_name ?? profile?.first_name) || 'there';
  const memberNameUpper = memberName.toUpperCase();
  const avatarInitial = (profile?.full_name ?? profile?.email ?? user.email ?? 'M').charAt(0).toUpperCase();

  // Membership progress
  let pctUsed = 0;
  if (subscription?.end_date && subscription?.start_date) {
    const start = new Date(subscription.start_date).getTime();
    const end = new Date(subscription.end_date).getTime();
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (end > start) {
      pctUsed = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
    }
  }

  const formatAmt = (n: number | null | undefined) => {
    const v = Number(n ?? 0);
    return `₦${v.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };
  const fmtPaymentDate = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
  };

  return (
    <div className="op-mobile m-dash">
      {/* Header */}
      <header className="op-header">
        <Link href="/dashboard/profile" className="op-header-avatar" aria-label="Profile & settings">
          {profile?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" />
          ) : (
            <span>{avatarInitial}</span>
          )}
        </Link>
        <div className="op-header-greet">
          Hi, {memberNameUpper}
          <small>{gym.name}</small>
        </div>
        <div className="op-header-actions">
          <a href="mailto:hello@gymflow.ng" className="op-icon-btn" aria-label="Support">
            <Headphones strokeWidth={1.8} />
            <span className="op-icon-pill">HELP</span>
          </a>
          <Link href="/checkin" className="op-icon-btn" aria-label="Scan QR check-in">
            <ScanLine strokeWidth={1.8} />
          </Link>
          <Link href="/dashboard/inbox" className="op-icon-btn" aria-label={unreadCount > 0 ? `Inbox · ${unreadCount} unread` : 'Inbox'}>
            <Bell strokeWidth={1.8} />
            {unreadCount > 0 && (
              <span className="op-icon-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </Link>
        </div>
      </header>

      <div className="op-stack">
        {/* Hero — subscription status */}
        <section className="op-hero" aria-label="Membership status">
          <div className="op-hero-top">
            <span className="op-hero-label">
              <ShieldCheck strokeWidth={2} />
              {isActive ? 'Active membership' : subscription ? 'Membership expired' : 'No active plan'}
              <Eye strokeWidth={1.8} />
            </span>
            <Link href="/dashboard/wallet" className="op-hero-secondary">
              Transaction history <ChevronRight strokeWidth={2.2} size={14} />
            </Link>
          </div>
          <div className="op-hero-amount">
            {isActive ? `${remaining} ${remaining === 1 ? 'day' : 'days'} left` : 'Renew now'}
            <ChevronRight strokeWidth={2.2} size={22} />
          </div>
          {subscription && (
            <div className="op-hero-bar"><span style={{ width: `${100 - pctUsed}%` }} /></div>
          )}
          <div className="op-hero-bottom">
            <span className="op-hero-meta">
              {isActive ? `Renews ${fmtDate(subscription!.end_date)}` : 'No active subscription'}
            </span>
            <Link href={isActive ? '/dashboard/wallet' : '/dashboard/renew'} className="op-hero-cta">
              <Plus strokeWidth={2.5} /> {isActive ? 'Top up' : 'Renew'}
            </Link>
          </div>
        </section>

        {/* Recent payments list */}
        {(recentPayments && recentPayments.length > 0) && (
          <section className="op-card">
            <div className="op-list">
              {recentPayments.map((p) => {
                const isSuccess = p.status === 'success' || p.status === 'completed';
                return (
                  <Link key={p.id} href={`/dashboard/wallet/${p.id}`} className="op-list-row">
                    <span className="op-list-ic" aria-hidden>
                      <ArrowUpRight />
                    </span>
                    <div className="op-list-m">
                      <div className="op-list-title">Membership payment{p.payment_method ? ` · ${p.payment_method}` : ''}</div>
                      <div className="op-list-sub">{fmtPaymentDate(p.created_at)}</div>
                    </div>
                    <div className="op-list-r">
                      <div className="op-list-amt">-{formatAmt(p.amount)}</div>
                      <span className={`op-list-status ${isSuccess ? '' : p.status === 'failed' ? 'is-failed' : 'is-pending'}`}>
                        {isSuccess ? 'Successful' : p.status || 'Pending'}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* 3 quick actions */}
        <section className="op-card">
          <div className="op-action-row">
            <Link href="/checkin" className="op-action-tile">
              <span className="op-ic"><QrCode /></span>
              <span className="op-action-tile-label">Check in</span>
            </Link>
            <Link href="/dashboard/wallet" className="op-action-tile">
              <span className="op-ic"><Wallet /></span>
              <span className="op-action-tile-label">Wallet</span>
            </Link>
            <Link href={isActive ? '/dashboard/wallet' : '/dashboard/renew'} className="op-action-tile">
              <span className="op-ic"><ArrowDownLeft /></span>
              <span className="op-action-tile-label">{isActive ? 'Manage' : 'Renew'}</span>
            </Link>
          </div>
        </section>

        {/* 4-col service grid */}
        <section className="op-card">
          <div className="op-grid">
            <Link href="/classes" className="op-grid-tile">
              <span className="op-ic"><CalendarDays /></span>
              <span className="op-grid-tile-label">Schedule</span>
            </Link>
            <Link href="/dashboard/instructors" className="op-grid-tile">
              <span className="op-ic"><GraduationCap /></span>
              <span className="op-grid-tile-label">Coaches</span>
            </Link>
            <Link href="/dashboard/pt-packs" className="op-grid-tile">
              {!isActive && <span className="op-grid-tile-badge is-amber">New</span>}
              <span className="op-ic"><Dumbbell /></span>
              <span className="op-grid-tile-label">PT Packs</span>
            </Link>
            <Link href="/dashboard/inbox" className="op-grid-tile">
              {unreadCount > 0 && <span className="op-grid-tile-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              <span className="op-ic"><Inbox /></span>
              <span className="op-grid-tile-label">Inbox</span>
            </Link>
            <Link href="/dashboard/wallet" className="op-grid-tile">
              <span className="op-ic"><Receipt /></span>
              <span className="op-grid-tile-label">Receipts</span>
            </Link>
            <Link href="/dashboard/cards" className="op-grid-tile">
              <span className="op-ic"><CreditCard /></span>
              <span className="op-grid-tile-label">Cards</span>
            </Link>
            <Link href="/dashboard/renew" className="op-grid-tile">
              {!isActive && <span className="op-grid-tile-badge is-brand">Hot</span>}
              <span className="op-ic"><Sparkles /></span>
              <span className="op-grid-tile-label">Renew</span>
            </Link>
            <Link href="/dashboard/profile" className="op-grid-tile">
              <span className="op-ic"><MoreHorizontal /></span>
              <span className="op-grid-tile-label">More</span>
            </Link>
          </div>
        </section>

        {/* Voucher promo — referral hook (placeholder until real referral wired) */}
        <section className="op-voucher" aria-label="Refer a friend">
          <div className="op-voucher-coin">
            <b>₦5K</b>
            <small>Bonus</small>
          </div>
          <div className="op-voucher-m">
            <strong>Refer a friend</strong>
            <small>Bring a buddy. Both of you get ₦5,000 off your next renewal.</small>
          </div>
          <Link href="/dashboard/profile" className="op-voucher-cta">Share</Link>
        </section>

        {/* Next-class promo OR last-checkin nudge */}
        <section className="op-promo">
          <span className="op-promo-ic" aria-hidden>
            {nextClass ? <CalendarDays /> : <Megaphone />}
          </span>
          <div className="op-promo-m">
            {nextClass ? (
              <>
                <strong>{nextClass.name} · {nextClass.dayLabel}</strong>
                <small>{nextClass.start}–{nextClass.end}{nextClass.room ? ` · ${nextClass.room}` : ''}{nextClass.instructor ? ` · ${nextClass.instructor}` : ''}</small>
              </>
            ) : (
              <>
                <strong>{activity.lastVisit ? `Last visit ${fmtDate(activity.lastVisit)}` : 'No check-ins yet'}</strong>
                <small>Scan the gym QR at the entrance to log your visit.</small>
              </>
            )}
          </div>
          <Link href={nextClass ? '/classes' : '/checkin'} className="op-promo-cta">
            {nextClass ? 'View' : 'Scan'}
          </Link>
        </section>

        {/* Activity stat trio */}
        <section className="op-card" aria-label="Your activity">
          <div className="op-action-row">
            <div className="op-action-tile" style={{ cursor: 'default' }}>
              <span className="op-ic"><Activity /></span>
              <span className="op-action-tile-label" style={{ fontSize: '1.1rem', fontWeight: 800 }}>{activity.visitsThisMonth}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--op-text-muted)', marginTop: -4 }}>This month</span>
            </div>
            <div className="op-action-tile" style={{ cursor: 'default' }}>
              <span className="op-ic"><UserCircle2 /></span>
              <span className="op-action-tile-label" style={{ fontSize: '1.1rem', fontWeight: 800 }}>{activity.currentStreak}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--op-text-muted)', marginTop: -4 }}>Day streak</span>
            </div>
            <div className="op-action-tile" style={{ cursor: 'default' }}>
              <span className="op-ic"><ScanLine /></span>
              <span className="op-action-tile-label" style={{ fontSize: '1.1rem', fontWeight: 800 }}>{activity.totalVisits}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--op-text-muted)', marginTop: -4 }}>Total visits</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import {
  Bell, CreditCard, ScanLine, CalendarDays, Wallet, QrCode, Flame, Check,
  Activity, CalendarCheck, Timer, Gift, CalendarClock,
} from 'lucide-react';
import { requireMember, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft, firstName, watNow, watDateISO, watDayStartUtc } from '@/lib/format';
import { ThemeToggle } from '@/components/theme-toggle';
import { ShareInvite } from '@/components/member/share-invite';

export const metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // Mon..Sun

export default async function MemberHome() {
  // Parallel: getProfile() only needs the cached getUser(), so its query
  // overlaps the membership-link resolution instead of waiting behind it.
  const [{ user, gym }, profile] = await Promise.all([requireMember(), getProfile()]);
  const supabase = await createClient();

  const now = new Date();
  // Anchor all day math to WAT (UTC+1) — the server runs UTC, so a UTC day
  // boundary mis-buckets check-ins between 00:00–01:00 WAT onto the previous day
  // (wrong streak, week grid and "today"). See lib/format.ts.
  const wnow = watNow();
  const today = watDateISO();
  const dow = (wnow.getUTCDay() + 6) % 7; // 0 = Monday (WAT)
  const weekStartDate = watDateISO(new Date(now.getTime() - dow * 86_400_000)); // WAT date of this week's Monday
  const weekStartIso = watDayStartUtc(weekStartDate); // UTC instant of WAT week start — lower bound for visits-this-week
  const monthStartIso = watDayStartUtc(`${today.slice(0, 7)}-01`); // UTC instant of WAT month start
  const since = new Date(now.getTime() - 70 * 86_400_000).toISOString();

  const [{ data: sub }, { count: unread }, { data: allCheckins }, { count: classesAttended }, { data: nextBooking }] = await Promise.all([
    // Include past_due so the dunning banner renders when Paystack failed the
    // last auto-charge; downstream code treats past_due as "still has access"
    // until the invoice.payment_failed grace window closes.
    supabase.from('member_subscriptions').select('status, start_date, end_date, plan_id')
      .eq('member_id', user.id).eq('gym_id', gym.id).in('status', ['active', 'past_due']).order('end_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
    supabase.from('check_ins').select('checked_in_at, checked_out_at, check_in_method')
      .eq('member_id', user.id).eq('gym_id', gym.id).gte('checked_in_at', since).order('checked_in_at', { ascending: false }),
    supabase.from('class_bookings').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'attended'),
    supabase.from('class_bookings').select('booking_date, class_id, status')
      .eq('member_id', user.id).eq('gym_id', gym.id).gte('booking_date', today).in('status', ['booked', 'confirmed'])
      .order('booking_date', { ascending: true }).limit(1).maybeSingle(),
  ]);

  // Resolve plan name + next-class name without relying on PostgREST embeds.
  const [{ data: plan }, { data: nextClass }] = await Promise.all([
    sub?.plan_id ? supabase.from('membership_plans').select('name').eq('id', sub.plan_id).maybeSingle() : Promise.resolve({ data: null }),
    nextBooking?.class_id ? supabase.from('classes').select('name, start_time').eq('id', nextBooking.class_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const checkins = allCheckins ?? [];
  // Bucket check-ins by WAT calendar day (not the UTC date of the timestamp) so a
  // 00:00–01:00 WAT visit lands on the right day for the streak + week grid.
  const daySet = new Set(checkins.map((c) => (c.checked_in_at ? watDateISO(new Date(c.checked_in_at)) : '')).filter(Boolean));
  const visitsThisMonth = checkins.filter((c) => (c.checked_in_at ?? '') >= monthStartIso).length;
  const visitsThisWeek = checkins.filter((c) => (c.checked_in_at ?? '') >= weekStartIso).length;

  // Current streak: consecutive prior WAT days with a check-in (today optional).
  // Anchor at noon UTC of the WAT date so whole-day steps never cross a boundary.
  let streak = 0;
  const cur = new Date(today + 'T12:00:00Z');
  if (!daySet.has(cur.toISOString().slice(0, 10))) cur.setUTCDate(cur.getUTCDate() - 1);
  while (daySet.has(cur.toISOString().slice(0, 10))) { streak++; cur.setUTCDate(cur.getUTCDate() - 1); }
  // Best streak across the window.
  const sortedDays = [...daySet].sort();
  let best = 0, run = 0; let prev: number | null = null;
  for (const k of sortedDays) {
    const t = Date.parse(k);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run); prev = t;
  }
  // Average session length from completed (checked-out) visits.
  const withDur = checkins.filter((c) => c.checked_out_at && c.checked_in_at);
  const avgMin = withDur.length
    ? Math.round(withDur.reduce((s, c) => s + (new Date(c.checked_out_at!).getTime() - new Date(c.checked_in_at!).getTime()) / 60000, 0) / withDur.length)
    : 0;

  // Week grid keyed by WAT calendar dates (Mon..Sun), anchored at noon UTC of the
  // WAT week start so consecutive-day slicing stays on the intended dates.
  const weekStartMs = Date.parse(weekStartDate + 'T12:00:00Z');
  const weekDays = DAY_LABELS.map((label, i) => {
    const key = new Date(weekStartMs + i * 86_400_000).toISOString().slice(0, 10);
    return { d: label, done: daySet.has(key), today: key === today, future: key > today };
  });
  const goal = 4;

  const name = firstName(profile?.full_name ?? profile?.first_name);
  const initial = (profile?.full_name ?? profile?.email ?? user.email ?? 'M').charAt(0).toUpperCase();
  const gymLogo = (gym as { logo_url?: string | null }).logo_url ?? null;
  const planName = plan?.name ?? 'Membership';
  const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
  const isActive = remaining > 0;
  const isPastDue = sub?.status === 'past_due';
  const unreadCount = unread ?? 0;
  const recent = checkins.slice(0, 3);

  return (
    <section className="view on" data-v="home">
      <div className="mhead">
        {gymLogo
          ? // .gym-logo is a fixed 42×42 box (object-fit:cover via CSS).
            <Image className="gym-logo" src={gymLogo} alt={gym.name} width={42} height={42} />
          : <span className="gf-avatar gf-avatar-md">{initial}</span>}
        <div style={{ flex: 1, minWidth: 0 }}><small>{gym.name}</small><strong>Hi, {name} 👋</strong></div>
        <ThemeToggle size={38} />
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38, marginLeft: 0 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} />{unreadCount > 0 && <span className="nub">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </Link>
      </div>

      {isPastDue && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--gf-danger-soft)', color: 'var(--gf-danger)',
            border: '1px solid var(--gf-danger)', borderRadius: 12,
            padding: '10px 14px', margin: '0 0 12px', fontSize: '0.86rem',
          }}
        >
          <CreditCard strokeWidth={2} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <strong>Auto-renew payment failed.</strong> Update your card to keep training.
          </div>
          <Link href="/dashboard/renew" className="gf-btn gf-btn-primary gf-btn-sm">Fix payment</Link>
        </div>
      )}

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
                <div><b>{streak}-day streak</b><small>{best > 0 ? `Best: ${best} day${best === 1 ? '' : 's'}` : 'Check in to start one'}</small></div>
              </div>
              <div className="week-goal"><b>{visitsThisWeek}/{goal}</b><small>Weekly goal</small></div>
            </div>
            <div className="week-days">
              {weekDays.map((w, i) => (
                <div key={i} className={`wd${w.done ? ' done' : ''}${w.today ? ' today' : ''}${w.future ? ' rest' : ''}`}>
                  <span>{w.d}</span>
                  <div className="dot"><Check strokeWidth={3} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="stat3">
            <div className="s"><Activity strokeWidth={1.9} /><b>{visitsThisMonth}</b><small>Visits this month</small></div>
            <div className="s"><CalendarCheck strokeWidth={1.9} /><b>{classesAttended ?? 0}</b><small>Classes attended</small></div>
            <div className="s"><Timer strokeWidth={1.9} /><b>{avgMin > 0 ? <>{avgMin}<span style={{ fontSize: '0.9rem' }}>m</span></> : '—'}</b><small>Avg session</small></div>
          </div>
        </div>

        <div className="col-b">
          <div className="sect-t">Next class <Link href="/classes">See all</Link></div>
          {nextBooking ? (
            <Link href="/classes" className="lc tap">
              <div className="ic"><CalendarClock strokeWidth={1.9} /></div>
              <div className="m"><strong>{nextClass?.name ?? 'Class'}</strong><small>{fmtDate(nextBooking.booking_date)}{nextClass?.start_time ? ` · ${String(nextClass.start_time).slice(0, 5)}` : ''}</small></div>
              <span className="gf-badge gf-badge-success">Booked</span>
            </Link>
          ) : (
            <Link href="/classes" className="lc tap">
              <div className="ic"><CalendarDays strokeWidth={1.9} /></div>
              <div className="m"><strong>No upcoming classes</strong><small>Browse the schedule to book one</small></div>
            </Link>
          )}

          <div className="promo">
            <span className="pic"><Gift strokeWidth={1.9} /></span>
            <div className="m"><strong>Refer &amp; earn ₦5,000</strong><small>Invite a friend to {gym.name}.</small></div>
            <ShareInvite gymName={gym.name} gymSlug={gym.slug} />
          </div>

          {recent.length > 0 && (
            <>
              <div className="sect-t">Recent check-ins</div>
              {recent.map((c, i) => (
                <div className="lc" key={i}>
                  <div className="ic"><Check strokeWidth={1.9} /></div>
                  <div className="m"><strong>Checked in</strong><small>{c.check_in_method ?? 'QR scan'}</small></div>
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

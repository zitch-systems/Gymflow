import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { fmtDate, firstName } from '@/lib/format';
import { startOfTodayIso, daysFromNowIso, todayIso, todayDate } from '@/lib/dates';
import { Stat, StatGrid } from '@/components/ui/stat';
import { Button } from '@/components/ui/button';
import {
  Users, BadgeCheck, Banknote, CalendarClock,
  ClipboardCheck, CalendarDays, Wallet, UserCircle2, LogOut,
} from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoachDashboard({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const startOfToday = startOfTodayIso();
  const nowIso = todayIso();
  const today = todayDate();
  const sevenDays = daysFromNowIso(7);
  const monthStartDate = new Date(startOfToday);
  monthStartDate.setDate(1);
  const monthStart = monthStartDate.toISOString();

  const [{ count: clientCount }, { count: activeSubs }, { data: monthSubs }, { data: upcoming }] = await Promise.all([
    supabase
      .from('instructor_subscriptions')
      .select('member_id', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id),
    supabase
      .from('instructor_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('status', 'active')
      .gte('end_date', today),
    supabase
      .from('instructor_subscriptions')
      .select('amount_paid')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .gte('created_at', monthStart),
    supabase
      .from('instructor_sessions')
      .select('id, scheduled_at, status, member_id, profiles:member_id(full_name)')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', nowIso)
      .lte('scheduled_at', sevenDays)
      .order('scheduled_at', { ascending: true })
      .limit(5),
  ]);

  const monthRevenue = (monthSubs ?? []).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
  const sharePct = gym.instructor_revenue_share_pct ?? 50;
  const myCut = Math.round((monthRevenue * sharePct) / 100);

  const profile = await getProfile();
  const coachName = firstName(profile?.full_name ?? profile?.first_name, 'Coach');
  const avatarInitial = (profile?.full_name ?? profile?.email ?? user.email ?? 'C').charAt(0).toUpperCase();

  return (
    <div className="member-portal member-app m-dash">
      <header className="m-head">
        <Link href="/coach/profile" className="m-head-avatar" aria-label="Profile">
          {profile?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" />
          ) : (
            <span>{avatarInitial}</span>
          )}
        </Link>
        <div className="m-head-text">
          <small>{gym.name} · Coach</small>
          <strong>Hi, {coachName} 👋</strong>
        </div>
        <form action={signOut} className="m-head-bell" style={{ padding: 0 }}>
          <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={16} strokeWidth={1.75} />} style={{ minWidth: 0, padding: '4px 8px' }}>
            <span className="sr-only">Sign out</span>
          </Button>
        </form>
      </header>

      <StatGrid>
        <Stat label="Clients" value={clientCount ?? 0} icon={Users} accent="emerald" />
        <Stat label="Active subs" value={activeSubs ?? 0} icon={BadgeCheck} accent="blue" />
        <Stat
          label="This month"
          value={`₦${monthRevenue.toLocaleString('en-NG')}`}
          icon={Banknote}
          accent="purple"
          hint={`Your share: ₦${myCut.toLocaleString('en-NG')} (${sharePct}%)`}
        />
        <Stat label="Upcoming (7d)" value={upcoming?.length ?? 0} icon={CalendarClock} accent="amber" />
      </StatGrid>

      {/* Quick actions — 5-up circular icon chips, grouped in a card (mirrors
          the member dashboard so every role's home feels like the same app). */}
      <div className="m-group">
        <section className="m-circ-row" aria-label="Quick actions">
          <Link href="/coach/attendance" className="m-circ">
            <span className="m-circ-ic"><ClipboardCheck /></span>
            <span className="m-circ-label">Attendance</span>
          </Link>
          <Link href="/coach/timetable" className="m-circ">
            <span className="m-circ-ic"><CalendarDays /></span>
            <span className="m-circ-label">Schedule</span>
          </Link>
          <Link href="/coach/clients" className="m-circ">
            <span className="m-circ-ic"><Users /></span>
            <span className="m-circ-label">Clients</span>
          </Link>
          <Link href="/coach/earnings" className="m-circ">
            <span className="m-circ-ic"><Wallet /></span>
            <span className="m-circ-label">Earnings</span>
          </Link>
          <Link href="/coach/profile" className="m-circ">
            <span className="m-circ-ic"><UserCircle2 /></span>
            <span className="m-circ-label">Profile</span>
          </Link>
        </section>
      </div>

      <div className="m-sect-t">Upcoming sessions</div>
      {upcoming && upcoming.length > 0 ? (
        <div className="m-links">
          {upcoming.map((s) => {
            const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
            const t = new Date(s.scheduled_at);
            return (
              <div key={s.id} className="m-lc">
                <span className="m-lc-ic"><CalendarClock size={18} strokeWidth={1.9} /></span>
                <span className="m-lc-m">
                  <strong>{p?.full_name ?? 'Member'}</strong>
                  <small>{fmtDate(s.scheduled_at)} · {t.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</small>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="m-lc" style={{ color: 'var(--gf-text-muted)' }}>
          <span className="m-lc-ic"><CalendarClock size={18} strokeWidth={1.9} /></span>
          <span className="m-lc-m"><small>No sessions in the next 7 days.</small></span>
        </div>
      )}
    </div>
  );
}

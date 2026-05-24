import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { fmtDate } from '@/lib/format';
import { startOfTodayIso, daysFromNowIso, todayIso, todayDate } from '@/lib/dates';
import { Stat, StatGrid } from '@/components/ui/stat';
import { QuickAction } from '@/components/ui/quick-action';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
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

  return (
    <div className="member-portal">
      <PageHeader
        title="Coach"
        subtitle={gym.name}
        actions={
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={16} strokeWidth={1.75} />}>
              Sign out
            </Button>
          </form>
        }
      />

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

      <section className="member-quick-actions">
        <QuickAction href="/coach/clients" icon={Users} label="Clients" />
        <QuickAction href="/coach/attendance" icon={ClipboardCheck} label="Attendance" />
        <QuickAction href="/coach/timetable" icon={CalendarDays} label="Timetable" />
        <QuickAction href="/coach/earnings" icon={Wallet} label="Earnings" />
        <QuickAction href="/coach/profile" icon={UserCircle2} label="Profile" />
      </section>

      {upcoming && upcoming.length > 0 && (
        <Card>
          <CardHeader title="Upcoming sessions" />
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {upcoming.map((s) => {
              const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
              return (
                <li key={s.id} style={{ padding: '12px 18px', borderTop: '1px solid var(--gf-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p?.full_name ?? 'Member'}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--gf-text-muted)' }}>{fmtDate(s.scheduled_at)} · {new Date(s.scheduled_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

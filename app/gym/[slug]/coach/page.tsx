import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, firstName } from '@/lib/format';
import { startOfTodayIso, daysFromNowIso, todayIso } from '@/lib/dates';
import { Stat } from '@/components/ui/stat';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Users, BadgeCheck, Wallet, CalendarCheck, ArrowRight, Dumbbell, CalendarX,
} from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoachDashboard({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const profile = await getProfile();
  const supabase = await createClient();

  const startOfToday = startOfTodayIso();
  const nowIso = todayIso();
  const sevenDays = daysFromNowIso(7);
  const monthStartDate = new Date(startOfToday);
  monthStartDate.setDate(1);
  const monthStart = monthStartDate.toISOString();
  const todayStartIso = startOfToday;
  const todayEndIso = new Date(new Date(startOfToday).getTime() + 86_400_000).toISOString();

  const [
    { count: clientCount },
    { count: activeSubs },
    { data: monthSubs },
    { data: upcoming },
    { data: todaySessions },
  ] = await Promise.all([
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
      .gte('end_date', nowIso),
    supabase
      .from('instructor_subscriptions')
      .select('id, amount_paid, start_date, end_date')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .gte('start_date', monthStart),
    supabase
      .from('instructor_sessions')
      .select('id, scheduled_at, member_id, duration_minutes, profiles:member_id(full_name)')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .gte('scheduled_at', nowIso)
      .lte('scheduled_at', sevenDays)
      .order('scheduled_at', { ascending: true })
      .limit(8),
    supabase
      .from('instructor_sessions')
      .select('id, scheduled_at, member_id, duration_minutes, status, profiles:member_id(full_name)')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .gte('scheduled_at', todayStartIso)
      .lt('scheduled_at', todayEndIso)
      .order('scheduled_at', { ascending: true }),
  ]);

  // Coach share comes from instructor_rates / gym configuration in a fuller
  // build; for the dashboard headline we approximate with a fixed 70% share
  // of the subscription revenue collected for sessions this month.
  const COACH_SHARE_PCT = 70;
  const monthRevenue = (monthSubs ?? []).reduce((s, m) => s + Number(m.amount_paid ?? 0), 0);
  const myCut = (monthRevenue * COACH_SHARE_PCT) / 100;

  const todayLabel = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Today&apos;s lineup, <span style={{ color: 'var(--gf-brand)' }}>{firstName(profile?.full_name ?? profile?.first_name, 'coach')}</span></h1>
          <p>
            {todayLabel}
            {(todaySessions ?? []).length > 0 ? ` · ${(todaySessions ?? []).length} session${(todaySessions ?? []).length === 1 ? '' : 's'} scheduled` : ' · no sessions today'}
            {monthRevenue > 0 ? ` · ${fmtNaira(myCut)} your share this month` : ''}
          </p>
        </div>
      </div>

      <section className="kpis">
        <Stat label="Sessions today" value={(todaySessions ?? []).length} accent="emerald" icon={CalendarCheck} />
        <Stat label="Members coached" value={clientCount ?? 0} accent="blue" icon={Users} />
        <Stat label="Earnings (mo)" value={fmtNaira(myCut)} accent="lime" icon={Wallet} hint={`Total ${fmtNaira(monthRevenue)}`} />
        <Stat label="Active subs" value={activeSubs ?? 0} accent="amber" icon={BadgeCheck} />
      </section>

      <div className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>My schedule</h3>
                <div className="sub">{todayLabel}</div>
              </div>
              <Link href="/coach/timetable" className="link">Full week <ArrowRight strokeWidth={2} /></Link>
            </div>
            {(todaySessions ?? []).length === 0 ? (
              <EmptyState icon={CalendarX} title="No sessions today" message="Free day. Upcoming sessions land below." />
            ) : (
              <div className="feed">
                {(todaySessions ?? []).map((s) => {
                  const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
                  const name = p?.full_name ?? 'Member';
                  const initial = name.charAt(0).toUpperCase();
                  const t = new Date(s.scheduled_at);
                  const time = t.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
                  const status = s.status === 'completed' ? { cls: 'gf-badge-neutral', label: 'Completed' } : { cls: 'gf-badge-brand', label: 'PT pack' };
                  return (
                    <div key={s.id} className="feed-row">
                      <span className="gf-avatar gf-avatar-sm" aria-hidden>{initial}</span>
                      <span className="feed-meta">
                        <strong>PT — {name}</strong>
                        <small>{time} · {s.duration_minutes ?? 60} min</small>
                      </span>
                      <span className={`gf-badge ${status.cls}`} style={{ flexShrink: 0 }}>
                        <span className="gf-dot" />
                        {status.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Upcoming (7 days)</h3>
                <div className="sub">{(upcoming ?? []).length} session{(upcoming ?? []).length === 1 ? '' : 's'} booked</div>
              </div>
              <Link href="/coach/timetable" className="link">Schedule <ArrowRight strokeWidth={2} /></Link>
            </div>
            {(upcoming ?? []).length === 0 ? (
              <div className="sub">No sessions in the next 7 days.</div>
            ) : (
              <div className="feed">
                {(upcoming ?? []).slice(0, 5).map((s) => {
                  const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
                  const name = p?.full_name ?? 'Member';
                  const initial = name.charAt(0).toUpperCase();
                  const t = new Date(s.scheduled_at);
                  const day = t.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric' });
                  const time = t.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
                  return (
                    <div key={s.id} className="feed-row">
                      <span className="gf-avatar gf-avatar-sm" aria-hidden>{initial}</span>
                      <span className="feed-meta">
                        <strong>{name}</strong>
                        <small>{day} · {time}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Clients</h3>
                <div className="sub">{clientCount ?? 0} total · {activeSubs ?? 0} active</div>
              </div>
              <Link href="/coach/clients" className="link">All clients <ArrowRight strokeWidth={2} /></Link>
            </div>
            {(clientCount ?? 0) === 0 ? (
              <EmptyState icon={Dumbbell} title="No clients yet" message="Coaching subscriptions land here when members sign up." />
            ) : (
              <div className="sub">{clientCount} member{clientCount === 1 ? '' : 's'} have you as their coach.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { CalendarCheck, Users, Wallet, Calendar, ArrowRight } from 'lucide-react';
import { requireInstructor, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, firstName } from '@/lib/format';

export const metadata = { title: 'Today · Instructor' };

export default async function CoachToday() {
  const { user, gym } = await requireInstructor();
  const profile = await getProfile();
  const supabase = await createClient();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const sixWeeksStart = new Date(); sixWeeksStart.setHours(0, 0, 0, 0); sixWeeksStart.setDate(sixWeeksStart.getDate() - 6 * 7);

  const [{ data: today }, { data: subs }, { data: monthSubs }, { data: weekSubs }] = await Promise.all([
    supabase.from('instructor_sessions')
      .select('id, scheduled_at, duration_minutes, status, member_id')
      .eq('instructor_id', user.id).eq('gym_id', gym.id)
      .gte('scheduled_at', dayStart.toISOString()).lt('scheduled_at', dayEnd.toISOString())
      .order('scheduled_at', { ascending: true }),
    supabase.from('instructor_subscriptions')
      .select('member_id, status, end_date')
      .eq('instructor_id', user.id).eq('gym_id', gym.id).eq('status', 'active'),
    supabase.from('instructor_subscriptions')
      .select('amount_paid, start_date')
      .eq('instructor_id', user.id).eq('gym_id', gym.id).gte('start_date', monthStart.toISOString().slice(0, 10)),
    supabase.from('instructor_subscriptions')
      .select('amount_paid, start_date')
      .eq('instructor_id', user.id).eq('gym_id', gym.id).gte('start_date', sixWeeksStart.toISOString().slice(0, 10)),
  ]);

  const sharePct = Number(gym.instructor_revenue_share_pct ?? 70);
  const monthGross = (monthSubs ?? []).reduce((s, m) => s + Number(m.amount_paid ?? 0), 0);
  const earnings = Math.round((monthGross * sharePct) / 100);

  // Real last-6-weeks earnings (PT subscription revenue × share), week 6 = now.
  const weeks = Array.from({ length: 6 }, () => 0);
  for (const s of weekSubs ?? []) {
    if (!s.start_date) continue;
    const weeksAgo = Math.floor((Date.now() - new Date(s.start_date).getTime()) / (7 * 86_400_000));
    const bucket = 5 - Math.min(5, Math.max(0, weeksAgo));
    weeks[bucket] += (Number(s.amount_paid ?? 0) * sharePct) / 100;
  }
  const maxW = Math.max(1, ...weeks);
  const clientCount = new Set((subs ?? []).map((s) => s.member_id).filter(Boolean)).size;
  const sessionsToday = (today ?? []).length;

  // Names for today's session rows + client list.
  const memberIds = [...new Set([...(today ?? []).map((t) => t.member_id), ...(subs ?? []).map((s) => s.member_id)].filter(Boolean) as string[])];
  const { data: profiles } = memberIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', memberIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  const coachName = firstName(profile?.full_name ?? profile?.first_name, 'coach');
  const todayLabel = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <div className="hdr"><h1>Today&apos;s lineup, <span>{coachName}</span></h1><p>{todayLabel} · {sessionsToday} session{sessionsToday === 1 ? '' : 's'} today · {fmtNaira(earnings)} earned this month</p></div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><CalendarCheck strokeWidth={1.9} /></div></div><div className="kpi-val">{sessionsToday}</div><div className="kpi-lbl">Sessions today</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Users strokeWidth={1.9} /></div></div><div className="kpi-val">{clientCount}</div><div className="kpi-lbl">Active clients</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Wallet strokeWidth={1.9} /></div></div><div className="kpi-val">{fmtNaira(earnings)}</div><div className="kpi-lbl">Earnings this month</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ffb0201f', color: '#ffb020' }}><Calendar strokeWidth={1.9} /></div></div><div className="kpi-val">{sharePct}%</div><div className="kpi-lbl">Revenue share</div></div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-h"><div><h3>My schedule</h3><div className="sub">{todayLabel}</div></div><Link className="link" href="/coach/classes">Full week <ArrowRight strokeWidth={2} /></Link></div>
          {sessionsToday === 0 ? (
            <div className="empty"><div className="eic"><CalendarCheck strokeWidth={1.6} /></div><h3>No sessions today</h3><p>Free day. Upcoming sessions land here.</p></div>
          ) : (
            <div className="tl">
              {(today ?? []).map((t) => {
                const time = new Date(t.scheduled_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
                const done = t.status === 'completed';
                return (
                  <div className="tl-row" key={t.id}>
                    <div className="tl-time"><b>{time}</b><span>{done ? 'done' : 'PT'}</span></div>
                    <div className="tl-card">
                      <div className="info"><strong>PT — {t.member_id ? nameById.get(t.member_id) : 'Member'}</strong><small>{t.duration_minutes ?? 60} min</small></div>
                      <span className={`gf-badge ${done ? 'gf-badge-neutral' : 'gf-badge-brand'}`}>{done ? 'Completed' : 'PT pack'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="payout">
            <small>This month</small>
            <div className="amt">{fmtNaira(earnings)}</div>
            <div style={{ fontSize: '0.82rem', opacity: 0.92 }}>{sharePct}% of {fmtNaira(monthGross)} gross</div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>Earnings</h3><div className="sub">Last 6 weeks</div></div></div>
            <div className="ec">
              {weeks.map((v, i) => <div className="col" key={i}><div className="bar" style={{ height: `${Math.max(3, Math.round((v / maxW) * 100))}%` }} title={fmtNaira(Math.round(v))} /><div className="lbl">W{i + 1}</div></div>)}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><h3>PT clients</h3><div className="sub">{clientCount} active pack{clientCount === 1 ? '' : 's'}</div></div></div>
            {(subs ?? []).length === 0 ? (
              <div className="sub">No active clients yet.</div>
            ) : (
              [...new Map((subs ?? []).map((s) => [s.member_id, s])).values()].slice(0, 6).map((s) => {
                const nm = s.member_id ? (nameById.get(s.member_id) ?? 'Member') : 'Member';
                return <div className="cl-row" key={s.member_id}><span className="gf-avatar gf-avatar-sm">{nm.charAt(0).toUpperCase()}</span><div className="m"><strong>{nm}</strong><small>Active PT pack</small></div></div>;
              })
            )}
          </div>
        </div>
      </section>
    </>
  );
}

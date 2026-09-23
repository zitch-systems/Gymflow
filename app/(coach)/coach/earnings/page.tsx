import { Wallet, CalendarCheck, Banknote, Hourglass } from 'lucide-react';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, watDateISO, watDayStartUtc, watMonthStartISO } from '@/lib/format';

export const metadata = { title: 'Earnings · Instructor' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function CoachEarnings() {
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();

  const monthStart = new Date(watDayStartUtc(watMonthStartISO()));
  const sixWeeksISO = watDateISO(new Date(Date.now() - 41 * 86_400_000));
  const sharePct = Number(gym.instructor_revenue_share_pct ?? 70);

  const [{ data: monthSubs }, { count: sessionsPaid }, { data: pendingPayouts }, { data: weekSubs }] = await Promise.all([
    supabase.from('instructor_subscriptions').select('amount_paid').eq('instructor_id', user.id).eq('gym_id', gym.id).gte('start_date', watMonthStartISO()),
    supabase.from('instructor_sessions').select('id', { count: 'exact', head: true }).eq('instructor_id', user.id).eq('gym_id', gym.id).eq('status', 'completed').gte('scheduled_at', monthStart.toISOString()),
    supabase.from('instructor_payouts').select('amount').eq('instructor_id', user.id).eq('gym_id', gym.id).neq('status', 'paid'),
    supabase.from('instructor_subscriptions').select('amount_paid, start_date').eq('instructor_id', user.id).eq('gym_id', gym.id).gte('start_date', sixWeeksISO),
  ]);

  const gross = (monthSubs ?? []).reduce((s, m) => s + Number(m.amount_paid ?? 0), 0);
  const earnings = Math.round((gross * sharePct) / 100);
  const pending = (pendingPayouts ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  // Real last-6-weeks earnings (PT subscription revenue × share), week 6 = now.
  const weeks = Array.from({ length: 6 }, () => 0);
  for (const s of weekSubs ?? []) {
    if (!s.start_date) continue;
    const weeksAgo = Math.floor((Date.now() - new Date(s.start_date).getTime()) / (7 * 86_400_000));
    const bucket = 5 - Math.min(5, Math.max(0, weeksAgo));
    weeks[bucket] += (Number(s.amount_paid ?? 0) * sharePct) / 100;
  }
  const maxW = Math.max(1, ...weeks);

  const KPIS = [
    { icon: Wallet, fg: '#11d18b', bg: '#11d18b1f', val: fmtNaira(earnings), lbl: 'This month' },
    { icon: CalendarCheck, fg: '#4080ff', bg: '#4080ff1f', val: String(sessionsPaid ?? 0), lbl: 'Sessions paid' },
    { icon: Banknote, fg: '#a8d92e', bg: '#c6f24e1f', val: `${sharePct}%`, lbl: 'Revenue share' },
    { icon: Hourglass, fg: '#ffb020', bg: '#ffb0201f', val: fmtNaira(pending), lbl: 'Pending payout' },
  ];

  return (
    <>
      <div className="hdr"><h1>Earnings</h1><p>{fmtNaira(earnings)} earned this month · {fmtNaira(gross)} gross at {sharePct}% share</p></div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <div className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Earnings trend</h3><div className="sub">Last 6 weeks</div></div></div>
          <div className="ec">{weeks.map((v, i) => <div className="col" key={i}><div className="bar" style={{ height: `${Math.max(3, Math.round((v / maxW) * 100))}%` }} title={fmtNaira(Math.round(v))} /><div className="lbl">W{i + 1}</div></div>)}</div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>This month</h3><div className="sub">From PT subscriptions</div></div></div>
          <div className="payout" style={{ marginTop: 4 }}>
            <small>Your share ({sharePct}%)</small>
            <div className="amt">{fmtNaira(earnings)}</div>
            <div style={{ fontSize: '0.82rem', opacity: 0.92 }}>of {fmtNaira(gross)} gross PT revenue</div>
          </div>
        </div>
      </div>
    </>
  );
}

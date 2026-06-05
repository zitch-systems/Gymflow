import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft, fmtDateTime, greeting, firstName } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { daysFromNowIso, startOfTodayIso, todayIso, daysAgoIso } from '@/lib/dates';
import { Stat } from '@/components/ui/stat';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Users, ScanLine, Clock, Wallet, ArrowRight, LogOut, AlertCircle, CalendarCheck,
} from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
};

export default async function AdminDashboard({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { role, gym } = await requireStaff(slug);
  const profile = await getProfile();

  const sp = await searchParams;
  const range = sp.range === 'week' || sp.range === 'month' ? sp.range : 'today';
  const rangeStart = range === 'month' ? daysAgoIso(30) : range === 'week' ? daysAgoIso(7) : startOfTodayIso();
  const rangeLabel = range === 'month' ? '30 days' : range === 'week' ? '7 days' : 'today';

  const supabase = await createClient();
  const todayDow = new Date().getUTCDay();

  const [
    { count: memberCount },
    { count: activeToday },
    { count: expiringSoon },
    { data: revenueRows },
    { data: payments14 },
    { data: feedCheckins },
    { data: checkins7 },
    { data: expiring7 },
    { data: joins7 },
    { data: todayClasses },
    { data: needsAttention },
  ] = await Promise.all([
    supabase.from('gym_member_links').select('*', { count: 'exact', head: true }).eq('gym_id', gym.id),
    supabase.from('check_ins').select('*', { count: 'exact', head: true }).eq('gym_id', gym.id).gte('checked_in_at', rangeStart),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('gym_id', gym.id).gte('end_date', todayIso()).lte('end_date', daysFromNowIso(7)),
    supabase.from('payments').select('amount').eq('gym_id', gym.id).eq('payment_status', 'successful').gte('payment_date', rangeStart),
    supabase.from('payments').select('amount, payment_date').eq('gym_id', gym.id).eq('payment_status', 'successful').gte('payment_date', daysAgoIso(14)),
    supabase.from('check_ins').select('checked_in_at, member_id, check_in_method').eq('gym_id', gym.id).order('checked_in_at', { ascending: false }).limit(8),
    supabase.from('check_ins').select('checked_in_at').eq('gym_id', gym.id).gte('checked_in_at', daysAgoIso(7)),
    supabase.from('memberships').select('end_date').eq('gym_id', gym.id).gte('end_date', todayIso()).lte('end_date', daysFromNowIso(7)),
    supabase.from('gym_member_links').select('joined_at').eq('gym_id', gym.id).gte('joined_at', daysAgoIso(7)),
    supabase
      .from('class_schedules')
      .select('id, start_time, end_time, room, classes(name, instructor, max_capacity)')
      .eq('gym_id', gym.id).eq('is_active', true).eq('day_of_week', todayDow)
      .order('start_time', { ascending: true }).limit(6),
    supabase
      .from('memberships')
      .select('member_id, end_date')
      .eq('gym_id', gym.id).gte('end_date', todayIso()).lte('end_date', daysFromNowIso(7))
      .order('end_date', { ascending: true }).limit(6),
  ]);

  const revenueRange = (revenueRows ?? []).reduce((acc, p) => acc + Number(p.amount ?? 0), 0);

  // Names for needs-attention rows.
  const attIds = [...new Set((needsAttention ?? []).map((m) => m.member_id).filter((x): x is string => Boolean(x)))];
  const { data: attentionProfiles } = attIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, last_name').in('id', attIds)
    : { data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null }> };
  const attNameById = new Map(
    (attentionProfiles ?? []).map((p) => [
      p.id,
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? 'Member',
    ]),
  );
  const attentionRows = (needsAttention ?? [])
    .map((m) => {
      const name = (m.member_id ? attNameById.get(m.member_id) : null) ?? 'Member';
      return {
        id: m.member_id ?? '',
        name,
        initial: name.charAt(0).toUpperCase(),
        end: m.end_date,
        daysOut: daysLeft(m.end_date),
      };
    })
    .filter((m) => m.id);

  // Revenue chart — 14 days bucketed by UTC day.
  const DAY_MS = 86_400_000;
  const revByDay = new Map<string, number>();
  for (const pay of payments14 ?? []) {
    if (!pay.payment_date) continue;
    const k = new Date(pay.payment_date).toISOString().split('T')[0];
    revByDay.set(k, (revByDay.get(k) ?? 0) + Number(pay.amount ?? 0));
  }
  const nowMs = new Date().getTime();
  const revSeries = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(nowMs - (13 - i) * DAY_MS);
    const k = d.toISOString().split('T')[0];
    return { date: k, amount: revByDay.get(k) ?? 0, dow: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getUTCDay()] };
  });
  const revMax = Math.max(1, ...revSeries.map((d) => d.amount));
  const revTotal = revSeries.reduce((a, d) => a + d.amount, 0);

  // KPI sparklines — 7-day series.
  const last7Keys = Array.from({ length: 7 }, (_, i) => new Date(nowMs - (6 - i) * DAY_MS).toISOString().split('T')[0]);
  const next7Keys = Array.from({ length: 7 }, (_, i) => new Date(nowMs + i * DAY_MS).toISOString().split('T')[0]);
  const countByDay = <T,>(rows: T[], pick: (r: T) => string | null | undefined, keys: string[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = pick(r);
      if (!v) continue;
      const k = new Date(v).toISOString().split('T')[0];
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return keys.map((k) => m.get(k) ?? 0);
  };
  const checkinSpark = countByDay(checkins7 ?? [], (r) => r.checked_in_at, last7Keys);
  const expiringSpark = countByDay(expiring7 ?? [], (r) => r.end_date, next7Keys);
  const revSpark = revSeries.slice(-7).map((d) => d.amount);
  const joinsByDay = countByDay(joins7 ?? [], (r) => r.joined_at, last7Keys);
  let runningMembers = memberCount ?? 0;
  const membersSpark: number[] = [];
  for (let i = last7Keys.length - 1; i >= 0; i--) {
    membersSpark[i] = runningMembers;
    runningMembers -= joinsByDay[i];
  }

  // Live feed.
  const feedIds = [...new Set((feedCheckins ?? []).map((c) => c.member_id).filter(Boolean) as string[])];
  const { data: feedProfiles } = feedIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, last_name').in('id', feedIds)
    : { data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null }> };
  const feedNameById = new Map(
    (feedProfiles ?? []).map((fp) => [fp.id, fp.full_name ?? ([fp.first_name, fp.last_name].filter(Boolean).join(' ') || 'Member')] as const),
  );
  const feed = (feedCheckins ?? []).map((c, i) => {
    const name = (c.member_id ? feedNameById.get(c.member_id) : null) || 'Member';
    return {
      id: `${c.checked_in_at ?? i}-${c.member_id ?? i}`,
      name,
      initial: name.charAt(0).toUpperCase(),
      method: c.check_in_method === 'self' ? 'QR · Self check-in'
        : c.check_in_method === 'staff' ? 'Front desk'
        : c.check_in_method === 'manual' ? 'Front desk'
        : c.check_in_method ?? 'Check-in',
      time: c.checked_in_at ? fmtDateTime(c.checked_in_at) : '',
    };
  });

  const rangeBtn = (r: 'today' | 'week' | 'month') => (r === 'today' ? '/admin/dashboard' : `/admin/dashboard?range=${r}`);

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--gf-text-muted)', fontWeight: 600, marginBottom: 2 }}>
              {gym.name}
            </span>
            {greeting()}, <span style={{ color: 'var(--gf-brand)' }}>
              {firstName(profile?.full_name ?? profile?.first_name, role === 'owner' ? 'owner' : 'team')}
            </span>
          </h1>
          <p>
            {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            {(activeToday ?? 0)} check-in{(activeToday ?? 0) === 1 ? '' : 's'} {range === 'today' ? 'today' : `· ${rangeLabel}`}
            {(expiringSoon ?? 0) > 0 ? ` · ${expiringSoon} membership${(expiringSoon ?? 0) === 1 ? '' : 's'} need${(expiringSoon ?? 0) === 1 ? 's' : ''} attention` : ''}
          </p>
        </div>
        <nav className="seg" aria-label="Date range">
          <Link href={rangeBtn('today')} className={range === 'today' ? 'on' : ''} aria-current={range === 'today' ? 'page' : undefined}>Today</Link>
          <Link href={rangeBtn('week')} className={range === 'week' ? 'on' : ''} aria-current={range === 'week' ? 'page' : undefined}>Week</Link>
          <Link href={rangeBtn('month')} className={range === 'month' ? 'on' : ''} aria-current={range === 'month' ? 'page' : undefined}>Month</Link>
          <form action={signOut} style={{ marginLeft: 8 }}>
            <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={14} strokeWidth={1.75} />}>
              Sign out
            </Button>
          </form>
        </nav>
      </div>

      <section className="kpis">
        <Stat label="Total members" value={memberCount ?? 0} accent="emerald" icon={Users} spark={membersSpark} />
        <Stat label={`Check-ins · ${rangeLabel}`} value={activeToday ?? 0} accent="blue" icon={ScanLine} spark={checkinSpark} />
        <Stat label="Expiring this week" value={expiringSoon ?? 0} accent="amber" icon={Clock} spark={expiringSpark} />
        <Stat label={`Revenue · ${rangeLabel}`} value={fmtNaira(revenueRange)} accent="lime" icon={Wallet} spark={revSpark} />
      </section>

      <div className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Revenue</h3>
                <div className="sub">Last 14 days · {fmtNaira(revTotal)} collected</div>
              </div>
              <Link href="/admin/analytics" className="link">View report <ArrowRight strokeWidth={2} /></Link>
            </div>
            <div className="chart" role="img" aria-label={`Daily revenue, ${fmtNaira(revTotal)} collected over 14 days`}>
              {revSeries.map((d, i) => (
                <div key={i} className="bar-col">
                  <div className={`bar${d.amount === 0 ? ' muted' : ''}`} style={{ height: `${Math.round((d.amount / revMax) * 100)}%` }} title={fmtNaira(d.amount)} />
                  <span className="bar-lbl">{d.dow}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Live check-ins</h3>
                <div className="sub"><span className="gf-status-dot active"><span className="gf-dot" />Live</span></div>
              </div>
            </div>
            {feed.length > 0 ? (
              <div className="feed">
                {feed.map((f) => (
                  <div key={f.id} className="feed-row">
                    <span className="gf-avatar gf-avatar-sm" aria-hidden>{f.initial}</span>
                    <span className="feed-meta"><strong>{f.name}</strong><small>{f.method}</small></span>
                    <span className="feed-time">{f.time}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={CalendarCheck} title="No check-ins yet" message="Check-ins appear here as members arrive." />
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Needs attention</h3>
                <div className="sub">Memberships expiring soon</div>
              </div>
            </div>
            {attentionRows.length === 0 ? (
              <div className="sub">No memberships expiring this week.</div>
            ) : (
              <div className="att">
                {attentionRows.map((m) => (
                  <Link key={m.id} href={`/admin/members/${m.id}`} className="att-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="gf-avatar gf-avatar-sm" aria-hidden><AlertCircle size={16} strokeWidth={2} /></span>
                    <span className="att-meta">
                      <strong>{m.name}</strong>
                      <small>Expires {fmtDate(m.end)} · {m.daysOut}d left</small>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Today's classes</h3>
                <div className="sub">{(todayClasses ?? []).length} session{(todayClasses ?? []).length === 1 ? '' : 's'} scheduled</div>
              </div>
              <Link href="/admin/classes" className="link">All classes <ArrowRight strokeWidth={2} /></Link>
            </div>
            {(todayClasses ?? []).length === 0 ? (
              <div className="sub">No sessions scheduled today.</div>
            ) : (
              <div className="cls">
                {(todayClasses ?? []).map((s) => {
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  return (
                    <div key={s.id} className="cls-row">
                      <span className="cls-time">{s.start_time.slice(0, 5)}</span>
                      <span className="cls-meta">
                        <strong>{cls?.name ?? 'Class'}</strong>
                        <small>{cls?.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}</small>
                      </span>
                      {cls?.max_capacity ? <span className="cap-num">{cls.max_capacity} spots</span> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

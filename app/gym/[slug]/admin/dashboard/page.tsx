import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft, fmtDateTime, greeting, firstName } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { daysFromNowIso, startOfTodayIso, todayIso, daysAgoIso } from '@/lib/dates';
import { Stat, StatGrid } from '@/components/ui/stat';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/badge';
import { ButtonLink, Button } from '@/components/ui/button';
import {
  Users, CalendarCheck, Clock4, Banknote,
  Plus, LogOut, UserPlus, AlertCircle,
} from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
};

export default async function AdminDashboard({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { role, gym } = await requireStaff(slug);
  const profile = await getProfile();

  // Today / Week / Month re-scopes the flow KPIs (check-ins + revenue). Stock
  // KPIs (members, expiring) stay as-is. Range lives in the URL — no client state.
  const sp = await searchParams;
  const range = sp.range === 'week' || sp.range === 'month' ? sp.range : 'today';
  const rangeStart = range === 'month' ? daysAgoIso(30) : range === 'week' ? daysAgoIso(7) : startOfTodayIso();
  const rangeLabel = range === 'month' ? 'last 30 days' : range === 'week' ? 'last 7 days' : 'today';

  const supabase = await createClient();

  const todayDow = new Date().getUTCDay();
  const [
    { count: memberCount },
    { count: activeToday },
    { count: expiringSoon },
    { data: revenueRows },
    { data: recentLinks },
    { data: payments14 },
    { data: feedCheckins },
    { data: checkins7 },
    { data: expiring7 },
    { data: joins7 },
    { data: todayClasses },
    { data: needsAttention },
  ] = await Promise.all([
    supabase
      .from('gym_member_links')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id),
    supabase
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('checked_in_at', rangeStart),
    supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('end_date', todayIso())
      .lte('end_date', daysFromNowIso(7)),
    supabase
      .from('payments')
      .select('amount')
      .eq('gym_id', gym.id)
      .eq('payment_status', 'successful')
      .gte('payment_date', rangeStart),
    supabase
      .from('gym_member_links')
      .select('user_id, joined_at, status')
      .eq('gym_id', gym.id)
      .order('joined_at', { ascending: false })
      .limit(5),
    supabase
      .from('payments')
      .select('amount, payment_date')
      .eq('gym_id', gym.id)
      .eq('payment_status', 'successful')
      .gte('payment_date', daysAgoIso(14)),
    supabase
      .from('check_ins')
      .select('checked_in_at, member_id, check_in_method')
      .eq('gym_id', gym.id)
      .order('checked_in_at', { ascending: false })
      .limit(8),
    // 7-day daily series for the KPI sparklines
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('gym_id', gym.id)
      .gte('checked_in_at', daysAgoIso(7)),
    supabase
      .from('memberships')
      .select('end_date')
      .eq('gym_id', gym.id)
      .gte('end_date', todayIso())
      .lte('end_date', daysFromNowIso(7)),
    supabase
      .from('gym_member_links')
      .select('joined_at')
      .eq('gym_id', gym.id)
      .gte('joined_at', daysAgoIso(7)),
    // Today's class sessions — for the "Today's classes" panel.
    supabase
      .from('class_schedules')
      .select('id, start_time, end_time, room, classes(name, instructor)')
      .eq('gym_id', gym.id)
      .eq('is_active', true)
      .eq('day_of_week', todayDow)
      .order('start_time', { ascending: true })
      .limit(6),
    // Needs attention — memberships expiring within 7 days, joined to member name.
    supabase
      .from('memberships')
      .select('member_id, end_date')
      .eq('gym_id', gym.id)
      .gte('end_date', todayIso())
      .lte('end_date', daysFromNowIso(7))
      .order('end_date', { ascending: true })
      .limit(6),
  ]);

  const revenueToday = (revenueRows ?? []).reduce((acc, p) => acc + Number(p.amount ?? 0), 0);

  const recentIds = (recentLinks ?? []).map((l) => l.user_id).filter(Boolean) as string[];
  const [{ data: recentProfiles }, { data: recentMemberships }] = await Promise.all([
    recentIds.length
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email').in('id', recentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null }> }),
    recentIds.length
      ? supabase.from('memberships').select('member_id, end_date, status').eq('gym_id', gym.id).in('member_id', recentIds)
      : Promise.resolve({ data: [] as Array<{ member_id: string | null; end_date: string; status: string | null }> }),
  ]);
  const profileById = new Map((recentProfiles ?? []).map((p) => [p.id, p]));
  const membershipByMember = new Map<string, { end_date: string; status: string | null }>();
  for (const m of recentMemberships ?? []) {
    if (m.member_id && !membershipByMember.has(m.member_id)) membershipByMember.set(m.member_id, m);
  }

  // Needs-attention member names — for the right-rail "expiring soon" panel.
  const attentionIds = [
    ...new Set((needsAttention ?? []).map((m) => m.member_id).filter((x): x is string => Boolean(x))),
  ];
  const { data: attentionProfiles } = attentionIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, last_name').in('id', attentionIds)
    : { data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null }> };
  const attentionNameById = new Map(
    (attentionProfiles ?? []).map((p) => [
      p.id,
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? 'Member',
    ]),
  );
  const attentionRows = (needsAttention ?? [])
    .map((m) => ({
      id: m.member_id ?? '',
      name: (m.member_id ? attentionNameById.get(m.member_id) : null) ?? 'Member',
      end: m.end_date,
      daysOut: daysLeft(m.end_date),
    }))
    .filter((m) => m.id);

  const recentRows = (recentLinks ?? []).map((l) => {
    const p = l.user_id ? profileById.get(l.user_id) : null;
    const m = l.user_id ? membershipByMember.get(l.user_id) : null;
    return {
      id: l.user_id ?? '',
      name: p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ') ?? '—',
      email: p?.email ?? '—',
      joined: l.joined_at ?? null,
      expiry: m?.end_date ?? null,
      status: m?.status ?? l.status ?? null,
    };
  });

  // Revenue (last 14 days), bucketed by UTC day, for the bar chart.
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

  // KPI sparklines — real 7-day series, UTC day buckets (oldest → newest).
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
  // Members: cumulative total across the last 7 days, back-calculated from today's
  // total minus the joins that landed after each day.
  const joinsByDay = countByDay(joins7 ?? [], (r) => r.joined_at, last7Keys);
  let runningMembers = memberCount ?? 0;
  const membersSpark: number[] = [];
  for (let i = last7Keys.length - 1; i >= 0; i--) {
    membersSpark[i] = runningMembers;
    runningMembers -= joinsByDay[i];
  }

  // Live check-in feed — recent check-ins joined to member names.
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
      method: c.check_in_method === 'self' ? 'QR self check-in' : c.check_in_method === 'staff' ? 'Front desk' : 'Check-in',
      time: c.checked_in_at ? fmtDateTime(c.checked_in_at) : '',
    };
  });

  return (
    <div className="gf-page">
      {/* Greeting header — gym name (small) + "Good morning, {first name}" with a
          contextual subtitle (date · check-ins this range · members needing attention).
          Matches revamp/admin.html voice while keeping the design-system PageHeader. */}
      <PageHeader
        title={
          <>
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--gf-text-muted)', fontWeight: 600, marginBottom: 2 }}>
              {gym.name}
            </span>
            {greeting()}, <span style={{ color: 'var(--gf-brand)' }}>{firstName(profile?.full_name ?? profile?.first_name, role === 'owner' ? 'owner' : 'team')}</span>
          </>
        }
        subtitle={
          <>
            {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            {(activeToday ?? 0)} check-in{(activeToday ?? 0) === 1 ? '' : 's'} {range === 'today' ? 'today' : `· ${rangeLabel}`}
            {(expiringSoon ?? 0) > 0 ? ` · ${expiringSoon} membership${(expiringSoon ?? 0) === 1 ? '' : 's'} need${(expiringSoon ?? 0) === 1 ? 's' : ''} attention` : ''}
          </>
        }
        actions={
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={16} strokeWidth={1.75} />}>
              Sign out
            </Button>
          </form>
        }
      />

      <nav className="adm-seg" aria-label="Date range">
        {(['today', 'week', 'month'] as const).map((r) => (
          <Link
            key={r}
            href={r === 'today' ? '/admin/dashboard' : `/admin/dashboard?range=${r}`}
            className={`adm-seg-btn${range === r ? ' on' : ''}`}
            aria-current={range === r ? 'page' : undefined}
          >
            {r === 'today' ? 'Today' : r === 'week' ? 'This week' : 'This month'}
          </Link>
        ))}
      </nav>

      <StatGrid>
        <Stat label="Total members" value={memberCount ?? 0} accent="emerald" icon={Users} spark={membersSpark} />
        <Stat label={`Check-ins · ${rangeLabel}`} value={activeToday ?? 0} accent="blue" icon={CalendarCheck} spark={checkinSpark} />
        <Stat label="Expiring this week" value={expiringSoon ?? 0} accent="amber" icon={Clock4} spark={expiringSpark} />
        <Stat label={`Revenue · ${rangeLabel}`} value={fmtNaira(revenueToday)} accent="purple" icon={Banknote} spark={revSpark} />
      </StatGrid>

      {/* 2-col grid mirrors revamp/admin.html: left = Revenue + Members,
          right = Live check-ins + Needs attention + Today's classes. */}
      <div className="adm-dash-grid">
        <div className="adm-dash-col">
          <Card>
            <CardHeader
              title="Revenue"
              action={
                <Link href="/admin/analytics" className="gf-link" style={{ fontSize: 13 }}>
                  View report →
                </Link>
              }
            />
            <div className="gf-page-subtitle" style={{ marginTop: -4, marginBottom: 12 }}>
              Last 14 days · {fmtNaira(revTotal)} collected
            </div>
            <div className="adm-revbars" role="img" aria-label={`Daily revenue, ${fmtNaira(revTotal)} collected over 14 days`}>
              {revSeries.map((d, i) => (
                <div key={i} className="adm-revbar" title={`${fmtNaira(d.amount)}`}>
                  <div className="adm-revbar-track">
                    <div className="adm-revbar-fill" style={{ height: `${Math.round((d.amount / revMax) * 100)}%` }} />
                  </div>
                  <span className="adm-revbar-x">{d.dow}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recent members"
              action={
                <ButtonLink href="/admin/members/new" variant="primary" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
                  Add member
                </ButtonLink>
              }
            />
            {recentRows.length === 0 ? (
              <EmptyState
                icon={UserPlus}
                title="No members yet"
                message="Members appear here after they sign up on the join page or are added by staff."
                action={
                  <ButtonLink href="/admin/members/new" variant="outline" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
                    Add the first member
                  </ButtonLink>
                }
              />
            ) : (
              <div className="gf-table-wrap">
                <table role="table" className="gf-table gf-table-cards">
                  <thead>
                    <tr role="row">
                      <th>Member</th>
                      <th>Joined</th>
                      <th>Expiry</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {recentRows.map((r) => {
                      const left = daysLeft(r.expiry);
                      const active = left > 0 && r.status !== 'cancelled';
                      return (
                        <tr role="row" key={r.id}>
                          <td role="cell">
                            <Link href={`/admin/members/${r.id}`} className="gf-link" style={{ fontWeight: 600 }}>
                              {r.name}
                            </Link>
                            <div className="gf-table-meta">{r.email}</div>
                          </td>
                          <td role="cell" data-label="Joined">{fmtDate(r.joined)}</td>
                          <td role="cell" data-label="Expiry">{fmtDate(r.expiry)}</td>
                          <td role="cell" data-label="Status">
                            <StatusPill tone={active ? 'on' : 'off'}>
                              {active ? `${left}d left` : (r.status ?? 'inactive')}
                            </StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="adm-dash-col">
          <Card>
            <CardHeader title="Live check-ins" />
            {feed.length > 0 ? (
              <div className="adm-feed">
                {feed.map((f) => (
                  <div key={f.id} className="adm-feed-row">
                    <span className="adm-feed-av" aria-hidden>{f.initial}</span>
                    <span className="adm-feed-m"><strong>{f.name}</strong><small>{f.method}</small></span>
                    <span className="adm-feed-t">{f.time}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={CalendarCheck} title="No check-ins yet" message="Check-ins appear here as members arrive." />
            )}
          </Card>

          <Card>
            <CardHeader title="Needs attention" />
            {attentionRows.length === 0 ? (
              <div className="gf-page-subtitle" style={{ padding: '6px 2px' }}>No memberships expiring this week.</div>
            ) : (
              <div className="adm-feed">
                {attentionRows.map((m) => (
                  <div key={m.id} className="adm-feed-row">
                    <span className="adm-feed-av" aria-hidden style={{ background: 'var(--gf-warning-soft)', color: 'var(--gf-warning)' }}>
                      <AlertCircle size={16} strokeWidth={2} />
                    </span>
                    <span className="adm-feed-m">
                      <Link href={`/admin/members/${m.id}`} className="gf-link" style={{ fontWeight: 600 }}>{m.name}</Link>
                      <small>Expires {fmtDate(m.end)}</small>
                    </span>
                    <span className="adm-feed-t">{m.daysOut}d left</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Today's classes"
              action={
                <Link href="/admin/classes" className="gf-link" style={{ fontSize: 13 }}>
                  All classes →
                </Link>
              }
            />
            {(todayClasses ?? []).length === 0 ? (
              <div className="gf-page-subtitle" style={{ padding: '6px 2px' }}>No sessions scheduled today.</div>
            ) : (
              <div className="adm-feed">
                {(todayClasses ?? []).map((s) => {
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  return (
                    <div key={s.id} className="adm-feed-row">
                      <span className="adm-feed-av" aria-hidden style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
                        <CalendarCheck size={16} strokeWidth={2} />
                      </span>
                      <span className="adm-feed-m">
                        <strong>{cls?.name ?? 'Class'}</strong>
                        <small>{cls?.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}</small>
                      </span>
                      <span className="adm-feed-t">{s.start_time.slice(0, 5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

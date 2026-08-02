import Link from 'next/link';
import {
  Users, ScanLine, Clock, Wallet, ArrowRight, CalendarDays, Inbox,
} from 'lucide-react';
import { requireStaff, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft, firstName, watNow, watDateISO, watDayStartUtc } from '@/lib/format';

export const metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const initialOf = (name: string) => name.charAt(0).toUpperCase();

export default async function AdminDashboard() {
  // Parallel: both resolve the same cached getUser(), so this costs one auth
  // round-trip instead of two sequential ones.
  const [{ gym }, profile] = await Promise.all([requireStaff(), getProfile()]);
  const supabase = await createClient();

  // Day boundaries follow WAT (UTC+1), not the server's UTC — otherwise "today"
  // gates (check-ins count, expiring window) and the per-day revenue buckets drift
  // for activity between 00:00–01:00 WAT. See lib/format.ts.
  const today = watDateISO();
  const todayStartIso = watDayStartUtc(today); // UTC instant of WAT midnight — lower bound for today's check-ins
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  // 7 WAT day keys, oldest → today, one per revenue bar.
  const dayKeys = Array.from({ length: 7 }, (_, i) => watDateISO(new Date(Date.now() - (6 - i) * 86_400_000)));
  const revSinceIso = watDayStartUtc(dayKeys[0]); // fetch from the start of the earliest WAT bucket day

  const [
    { count: members }, { count: checkins }, { data: expiring }, { data: pay },
    { data: links }, { data: feed }, { data: schedules },
  ] = await Promise.all([
    supabase.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('is_active', true),
    supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).gte('checked_in_at', todayStartIso),
    supabase.from('member_subscriptions').select('id, member_id, end_date, membership_plans(name)').eq('gym_id', gym.id).eq('status', 'active').gte('end_date', today).lte('end_date', weekAhead).order('end_date', { ascending: true }).limit(5),
    supabase.from('payments').select('amount, payment_date').eq('gym_id', gym.id).eq('payment_status', 'successful').gte('payment_date', revSinceIso),
    supabase.from('gym_member_links').select('user_id, member_id, joined_at').eq('gym_id', gym.id).order('joined_at', { ascending: false }).limit(4),
    supabase.from('check_ins').select('member_id, check_in_method, checked_in_at').eq('gym_id', gym.id).order('checked_in_at', { ascending: false }).limit(3),
    supabase.from('class_schedules').select('id, start_time, room, classes(name, instructor, max_capacity)').eq('gym_id', gym.id).eq('is_active', true).eq('day_of_week', watNow().getUTCDay()).order('start_time', { ascending: true }), // day_of_week in WAT, not server UTC
  ]);

  // ── Revenue · trailing 7 days, one bar per WAT day ──
  // Bucket each payment by its WAT calendar day (was the UTC date via slice(0,10),
  // which mis-buckets 00:00–01:00 WAT payments onto the previous day).
  const revByDay = dayKeys.map((key) =>
    (pay ?? [])
      .filter((p) => p.payment_date && watDateISO(new Date(p.payment_date)) === key)
      .reduce((s, p) => s + Number(p.amount ?? 0), 0),
  );
  const revTotal = revByDay.reduce((s, v) => s + v, 0);
  const revMax = Math.max(...revByDay, 1);

  // ── Names for recent members, the check-in feed and the expiring list ──
  const recentIds = (links ?? []).map((l) => (l.member_id ?? l.user_id) as string).filter(Boolean);
  const feedIds = (feed ?? []).map((f) => f.member_id).filter(Boolean) as string[];
  const expIds = (expiring ?? []).map((e) => e.member_id).filter(Boolean) as string[];
  const allIds = [...new Set([...recentIds, ...feedIds, ...expIds])];
  // Second batch in one round-trip set: names, recent subscriptions and plans
  // only depend on the first batch (previously three sequential awaits).
  const [{ data: profiles }, { data: recentSubs }, { data: plans }] = await Promise.all([
    allIds.length
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email').in('id', allIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null }[] }),
    recentIds.length
      ? supabase.from('member_subscriptions').select('member_id, plan_id, status, end_date').eq('gym_id', gym.id).in('member_id', recentIds)
      : Promise.resolve({ data: [] as { member_id: string; plan_id: string | null; status: string | null; end_date: string | null }[] }),
    supabase.from('membership_plans').select('id, name, price').eq('gym_id', gym.id),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Member']));
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email ?? '—']));

  // ── Recent members table (plan/status via their latest subscription) ──
  const planById = new Map((plans ?? []).map((p) => [p.id, p]));
  const subByMember = new Map((recentSubs ?? []).map((s) => [s.member_id, s]));

  const memberRows = recentIds.map((id) => {
    const name = nameById.get(id) ?? 'Member';
    const sub = subByMember.get(id);
    const plan = sub?.plan_id ? planById.get(sub.plan_id) : null;
    const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
    const isActive = sub?.status === 'active' && (sub.end_date ?? '') >= today;
    const status: [string, string] = isActive && remaining <= 7 ? ['gf-badge-warning', 'Expiring'] : isActive ? ['gf-badge-success', 'Active'] : ['gf-badge-danger', 'Expired'];
    return {
      id, name, initial: initialOf(name), email: emailById.get(id) ?? '—',
      plan: plan?.name ?? '—', status,
      renews: isActive ? (remaining <= 7 ? `in ${remaining} day${remaining === 1 ? '' : 's'}` : fmtDate(sub!.end_date)) : '—',
      value: plan ? fmtNaira(Number(plan.price)) : '—',
    };
  });

  const KPIS = [
    { icon: Users, fg: '#11d18b', bg: 'rgba(17,209,139,0.12)', val: String(members ?? 0), lbl: 'Active members' },
    { icon: ScanLine, fg: '#4080ff', bg: 'rgba(64,128,255,0.12)', val: String(checkins ?? 0), lbl: 'Check-ins today' },
    { icon: Clock, fg: '#ffb020', bg: 'rgba(255,176,32,0.12)', val: String((expiring ?? []).length), lbl: 'Expiring this week' },
    { icon: Wallet, fg: '#a8d92e', bg: 'rgba(198,242,78,0.12)', val: fmtNaira(revTotal), lbl: 'Revenue · 7 days' },
  ];

  // Greet on the GYM's clock, not the server's. `new Date().getHours()` is UTC
  // on Vercel, so a Lagos owner opening the console at 12:30 WAT (11:30 UTC) was
  // told "Good morning" — the rest of this page already works in WAT.
  const hour = watNow().getUTCHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const ownerName = firstName(profile?.full_name ?? profile?.first_name, 'there');
  const fmtTime = (t: string | null) => (t ? String(t).slice(0, 5) : '—');
  const feedTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

  return (
    <>
      <div className="hdr">
        <div>
          <h1>{greet}, <span>{ownerName}</span></h1>
          <p>{gym.name} · {checkins ?? 0} check-in{checkins === 1 ? '' : 's'} today · {(expiring ?? []).length} membership{(expiring ?? []).length === 1 ? '' : 's'} expiring this week</p>
        </div>
      </div>

      <section className="kpis">
        {KPIS.map((k) => {
          const Icon = k.icon;
          return (
            <div className="kpi" key={k.lbl}>
              <div className="kpi-top">
                <div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div>
              </div>
              <div className="kpi-val">{k.val}</div>
              <div className="kpi-lbl">{k.lbl}</div>
            </div>
          );
        })}
      </section>

      <section className="grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h">
              <div><h3>Revenue</h3><div className="sub">Last 7 days · {fmtNaira(revTotal)} collected</div></div>
              <Link className="link" href="/admin/analytics">View report <ArrowRight strokeWidth={2} /></Link>
            </div>
            <div className="chart">
              {revByDay.map((v, i) => (
                <div className="bar-col" key={i}>
                  <div className="bar" style={{ height: `${Math.max(Math.round((v / revMax) * 100), v > 0 ? 4 : 2)}%` }} data-v={fmtNaira(v)} />
                  <span className="bar-lbl">{new Date(dayKeys[i] + 'T12:00:00Z').toLocaleDateString('en-NG', { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Members</h3><div className="sub">{members ?? 0} active · {(expiring ?? []).length} expiring this week</div></div>
              <Link className="link" href="/admin/members">All members <ArrowRight strokeWidth={2} /></Link>
            </div>
            {memberRows.length === 0 ? (
              <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No members yet</h3><p>New sign-ups will appear here.</p></div>
            ) : (
              // .tbl-scroll: without it the ~620px-wide table stretches the
              // whole document (~276px of body-level horizontal scroll on a
              // 390px phone). Same wrapper the members page uses.
              <div className="tbl-scroll">
                <table className="mtbl">
                  <thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Renews</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                  <tbody>
                    {memberRows.map((m) => (
                      <tr key={m.id}>
                        <td><Link href={`/admin/members/${m.id}`} className="who"><span className="gf-avatar gf-avatar-sm">{m.initial}</span><div><strong>{m.name}</strong><small>{m.email}</small></div></Link></td>
                        <td>{m.plan}</td>
                        <td><span className={`gf-badge ${m.status[0]}`}>{m.status[1]}</span></td>
                        <td>{m.renews}</td>
                        <td className="naira" style={{ textAlign: 'right' }}>{m.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-h">
              <div><h3>Live check-ins</h3><div className="sub"><span className="gf-status-dot active">Live</span></div></div>
              <Link className="link" href="/admin/staff-checkin">Front desk <ArrowRight strokeWidth={2} /></Link>
            </div>
            {(feed ?? []).length === 0 ? (
              <div className="empty"><div className="eic"><ScanLine strokeWidth={1.6} /></div><h3>No check-ins yet</h3><p>Today&apos;s arrivals will appear here.</p></div>
            ) : (
              <div className="feed">
                {(feed ?? []).map((f, i) => {
                  const nm = f.member_id ? (nameById.get(f.member_id) ?? 'Member') : 'Member';
                  return (
                    <div className="feed-row" key={i}>
                      <span className="gf-avatar gf-avatar-sm">{initialOf(nm)}</span>
                      <span className="feed-meta"><strong>{nm}</strong><small>{f.check_in_method ?? 'QR'}</small></span>
                      <span className="feed-time">{feedTime(f.checked_in_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h"><div><h3>Needs attention</h3><div className="sub">Memberships expiring soon</div></div></div>
            {(expiring ?? []).length === 0 ? (
              <div className="empty"><div className="eic"><Inbox strokeWidth={1.6} /></div><h3>All clear</h3><p>Nothing lapses in the next 7 days.</p></div>
            ) : (
              <div className="att">
                {(expiring ?? []).map((e) => {
                  const nm = e.member_id ? (nameById.get(e.member_id) ?? 'Member') : 'Member';
                  const plan = (e as unknown as { membership_plans: { name: string } | null }).membership_plans?.name ?? 'Membership';
                  const left = daysLeft(e.end_date);
                  return (
                    <div className="att-row" key={e.id}>
                      <span className="gf-avatar gf-avatar-sm">{initialOf(nm)}</span>
                      <span className="att-meta"><strong>{nm}</strong><small>{plan} expires {left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}</small></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h"><div><h3>Today&apos;s classes</h3><div className="sub">{(schedules ?? []).length} session{(schedules ?? []).length === 1 ? '' : 's'} scheduled</div></div></div>
            {(schedules ?? []).length === 0 ? (
              <div className="empty"><div className="eic"><CalendarDays strokeWidth={1.6} /></div><h3>No classes today</h3><p>The timetable is clear.</p></div>
            ) : (
              <div className="cls">
                {(schedules ?? []).map((s) => {
                  const c = (s as unknown as { classes: { name: string; instructor: string | null; max_capacity: number | null } | null }).classes;
                  return (
                    <Link href={`/admin/classes/${s.id}`} className="cls-row" key={s.id} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <span className="cls-time">{fmtTime(s.start_time)}</span>
                      <span className="cls-meta"><strong>{c?.name ?? 'Class'}</strong><small>{[c?.instructor, s.room].filter(Boolean).join(' · ') || '—'}</small></span>
                      {c?.max_capacity != null && <span className="cap">cap {c.max_capacity}</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

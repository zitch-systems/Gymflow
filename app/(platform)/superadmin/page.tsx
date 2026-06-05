import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtNaira } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { daysAgoIso } from '@/lib/dates';
import { SuperadminGymRowActions } from './gym-row-actions';
import { Stat } from '@/components/ui/stat';
import { Button, ButtonLink } from '@/components/ui/button';
import {
  Plus, LogOut, Building2, Repeat, Users, TrendingDown, AlertTriangle,
  ArrowRight, ArrowUpCircle, Banknote,
} from 'lucide-react';

// Gradient palette for the .gname .sq avatar — picks deterministically by first letter
// so the same gym always gets the same colour across reloads/sessions.
const GRADS = [
  'linear-gradient(135deg, #11d18b, #07a86c)',
  'linear-gradient(135deg, #4080ff, #2a5cc0)',
  'linear-gradient(135deg, #a8d92e, #6a9c00)',
  'linear-gradient(135deg, #ffb020, #cc8a10)',
  'linear-gradient(135deg, #b67bf3, #7c45c0)',
  'linear-gradient(135deg, #ff4560, #cc2a40)',
  'linear-gradient(135deg, #00c896, #008e6c)',
];
const gradFor = (s: string) => GRADS[s.charCodeAt(0) % GRADS.length];

const DAY_MS = 86_400_000;

export default async function SuperadminPage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const admin = await createClient();
  const since30 = daysAgoIso(30);
  const since35 = daysAgoIso(35);
  const since365 = daysAgoIso(365);

  const [
    { data: gyms },
    { count: gymCount },
    { count: activeGymCount },
    { count: profileCount },
    { data: platformPayments30 },
    { data: platformPayments12mo },
    { data: recentChurn },
    { data: paidGymIds },
    { data: memberCounts },
  ] = await Promise.all([
    admin
      .from('gyms')
      .select('id, name, slug, subscription_status, subscription_plan, created_at, trial_ends_at, email')
      .order('created_at', { ascending: false })
      .limit(100),
    admin.from('gyms').select('*', { count: 'exact', head: true }),
    admin.from('gyms').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin
      .from('platform_payments')
      .select('amount, created_at, gym_id')
      .eq('payment_status', 'successful')
      .gte('created_at', since30),
    admin
      .from('platform_payments')
      .select('amount, created_at')
      .eq('payment_status', 'successful')
      .gte('created_at', since365),
    admin
      .from('gyms')
      .select('id', { count: 'exact' })
      .in('subscription_status', ['suspended', 'terminated', 'cancelled'])
      .gte('updated_at', since30),
    admin
      .from('platform_payments')
      .select('gym_id')
      .eq('payment_status', 'successful')
      .gte('created_at', since35),
    admin
      .from('gym_member_links')
      .select('gym_id'),
  ]);

  const mrr30 = (platformPayments30 ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const churned = recentChurn?.length ?? 0;
  const totalGyms = gymCount ?? 0;
  const activeGyms = activeGymCount ?? 0;
  const churnPct = totalGyms > 0 ? Math.round((churned / totalGyms) * 1000) / 10 : 0;

  const paidIds = new Set((paidGymIds ?? []).map((r) => r.gym_id));
  const overdue = (gyms ?? []).filter((g) => g.subscription_status === 'active' && !paidIds.has(g.id)).length;
  const trialCount = (gyms ?? []).filter((g) => g.subscription_status === 'trial').length;

  // Per-gym member counts.
  const membersByGym = new Map<string, number>();
  for (const m of memberCounts ?? []) {
    if (!m.gym_id) continue;
    membersByGym.set(m.gym_id, (membersByGym.get(m.gym_id) ?? 0) + 1);
  }
  const totalMembers = Array.from(membersByGym.values()).reduce((a, b) => a + b, 0);

  // 12-month MRR series for the area chart.
  const nowMs = new Date().getTime();
  const months: { label: string; ts: number; amount: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    d.setHours(0, 0, 0, 0);
    months.push({ label: d.toLocaleDateString('en-NG', { month: 'short' }), ts: d.getTime(), amount: 0 });
  }
  for (const p of platformPayments12mo ?? []) {
    if (!p.created_at) continue;
    const t = new Date(p.created_at).getTime();
    for (let i = months.length - 1; i >= 0; i--) {
      if (t >= months[i].ts) { months[i].amount += Number(p.amount ?? 0); break; }
    }
  }
  const mrrMax = Math.max(1, ...months.map((m) => m.amount));
  const mrrPath = months
    .map((m, i) => {
      const x = (i / Math.max(1, months.length - 1)) * 600;
      const y = 200 - (m.amount / mrrMax) * 160 - 20;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const mrrArea = `${mrrPath} L600,200 L0,200 Z`;
  const mrr12mo = months.reduce((s, m) => s + m.amount, 0);

  // Recent activity — composed from the data we have (new gym signups + biggest
  // platform payments in the last 30 days). Sorted by timestamp.
  type Activity = {
    id: string;
    icon: 'building' | 'banknote' | 'alert' | 'upgrade';
    title: string;
    sub: string;
    at: number;
  };
  const activity: Activity[] = [];
  for (const g of gyms ?? []) {
    if (!g.created_at) continue;
    const t = new Date(g.created_at).getTime();
    if (nowMs - t > 14 * DAY_MS) continue;
    activity.push({
      id: `g-${g.id}`,
      icon: 'building',
      title: 'New gym onboarded',
      sub: `${g.name} · ${g.subscription_plan ?? 'Trial'}`,
      at: t,
    });
  }
  for (const p of platformPayments30 ?? []) {
    if (!p.created_at) continue;
    const gym = (gyms ?? []).find((g) => g.id === p.gym_id);
    activity.push({
      id: `p-${p.created_at}-${p.gym_id}`,
      icon: 'banknote',
      title: `${fmtNaira(Number(p.amount ?? 0))} subscription paid`,
      sub: gym ? `${gym.name} · ${gym.subscription_plan ?? '—'}` : 'GymFlow platform',
      at: new Date(p.created_at).getTime(),
    });
  }
  activity.sort((a, b) => b.at - a.at);
  const activityRows = activity.slice(0, 6);

  const relativeTime = (ts: number) => {
    const diff = nowMs - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  };

  const newGyms30 = (gyms ?? []).filter((g) => g.created_at && nowMs - new Date(g.created_at).getTime() <= 30 * DAY_MS).length;

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <span className="pill-plat"><Building2 size={11} strokeWidth={2.5} /> Platform overview</span>
          <h1>{totalGyms.toLocaleString()} gym{totalGyms === 1 ? '' : 's'} running on GymFlow</h1>
          <p>
            {new Date().toLocaleDateString('en-NG', { month: 'long' })} · {fmtNaira(mrr30)} processed (30d) ·
            {' '}{activeGyms} active · {newGyms30} new this month
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ButtonLink href="/superadmin/gyms/new" variant="primary" size="sm" leadingIcon={<Plus size={14} strokeWidth={2} />}>
            Onboard a gym
          </ButtonLink>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={14} strokeWidth={1.75} />}>
              Sign out
            </Button>
          </form>
        </div>
      </div>

      <section className="kpis">
        <Stat label="Active gyms" value={activeGyms} accent="emerald" icon={Building2}
          delta={newGyms30 > 0 ? { dir: 'up', value: `+${newGyms30}` } : undefined} />
        <Stat label="Platform MRR (30d)" value={fmtNaira(mrr30)} accent="lime" icon={Repeat} />
        <Stat label="Members platform-wide" value={totalMembers.toLocaleString()} accent="blue" icon={Users}
          hint={`${(profileCount ?? 0).toLocaleString()} profiles`} />
        <Stat label="Monthly churn" value={`${churnPct}%`} accent="rose" icon={TrendingDown}
          delta={churned > 0 ? { dir: 'down', value: `${churned} closed` } : undefined} />
      </section>

      <section className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Platform MRR</h3>
                <div className="sub">Trailing 12 months · {fmtNaira(mrr12mo)}</div>
              </div>
              <Link href="/superadmin/revenue" className="link">Revenue report <ArrowRight strokeWidth={2} /></Link>
            </div>
            <svg viewBox="0 0 600 200" preserveAspectRatio="none" style={{ width: '100%', height: 200 }}>
              <defs>
                <linearGradient id="sa-rev" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#11d18b" stopOpacity="0.32" />
                  <stop offset="1" stopColor="#11d18b" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={mrrArea} fill="url(#sa-rev)" />
              <path d={mrrPath} fill="none" stroke="#11d18b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--gf-text-muted)', fontSize: '0.68rem', fontWeight: 600, marginTop: 8 }}>
              {months.filter((_, i) => i % 2 === 1).map((m) => <span key={m.ts}>{m.label}</span>)}
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Recent activity</h3>
                <div className="sub">Platform-wide</div>
              </div>
              <Link href="/superadmin/audit" className="link">Audit log <ArrowRight strokeWidth={2} /></Link>
            </div>
            {activityRows.length === 0 ? (
              <div className="sub">No platform activity in the last 14 days.</div>
            ) : (
              <div>
                {activityRows.map((a) => {
                  const Icon = a.icon === 'building' ? Building2 : a.icon === 'banknote' ? Banknote : a.icon === 'alert' ? AlertTriangle : ArrowUpCircle;
                  const tint =
                    a.icon === 'building' ? { bg: 'var(--gf-brand-soft)', fg: 'var(--gf-brand)' } :
                    a.icon === 'banknote' ? { bg: 'var(--gf-success-soft)', fg: 'var(--gf-success)' } :
                    a.icon === 'alert' ? { bg: 'var(--gf-warning-soft)', fg: 'var(--gf-warning)' } :
                    { bg: 'var(--gf-info-soft)', fg: 'var(--gf-info)' };
                  return (
                    <div key={a.id} className="act-row">
                      <div className="ic" style={{ background: tint.bg, color: tint.fg }} aria-hidden>
                        <Icon strokeWidth={1.9} />
                      </div>
                      <div className="m">
                        <strong>{a.title}</strong>
                        <small>{a.sub}</small>
                      </div>
                      <span className="t">{relativeTime(a.at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="panel">
        <div className="panel-h">
          <div>
            <h3>Gyms</h3>
            <div className="sub">
              {totalGyms.toLocaleString()} total · {trialCount} on trial · {overdue} past due
            </div>
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Gym</th>
              <th>Plan</th>
              <th>Members</th>
              <th>Status</th>
              <th>Trial ends</th>
              <th style={{ textAlign: 'right' }} />
            </tr>
          </thead>
          <tbody>
            {(gyms ?? []).map((g) => {
              const members = membersByGym.get(g.id) ?? 0;
              const status = g.subscription_status ?? '—';
              const isActive = status === 'active';
              const isTrial = status === 'trial';
              const isPastDue = status === 'active' && !paidIds.has(g.id);
              const badgeCls = isPastDue ? 'gf-badge-danger' : isTrial ? 'gf-badge-warning' : isActive ? 'gf-badge-success' : 'gf-badge-neutral';
              const badgeLabel = isPastDue ? 'Past due' : isTrial ? 'Trial' : isActive ? 'Active' : status;
              return (
                <tr key={g.id}>
                  <td>
                    <a
                      href={`https://${g.slug}.gymflow.ng/admin/dashboard`}
                      target="_blank"
                      rel="noreferrer"
                      className="gname"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <span className="sq" style={{ background: gradFor(g.name ?? g.slug ?? 'G') }}>
                        {(g.name ?? g.slug ?? 'G').charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <strong>{g.name}</strong>
                        <small>{g.slug}.gymflow.ng · {g.email ?? '—'}</small>
                      </div>
                    </a>
                  </td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{g.subscription_plan ?? '—'}</td>
                  <td className="naira" style={{ color: 'var(--gf-text-secondary)' }}>{members.toLocaleString()}</td>
                  <td>
                    <span className={`gf-badge ${badgeCls}`}>
                      <span className="gf-dot" />
                      {badgeLabel}
                    </span>
                  </td>
                  <td style={{ color: 'var(--gf-text-secondary)' }}>{g.trial_ends_at ? fmtDate(g.trial_ends_at) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <SuperadminGymRowActions
                      gymId={g.id}
                      slug={g.slug}
                      ownerEmail={g.email ?? ''}
                      status={status}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

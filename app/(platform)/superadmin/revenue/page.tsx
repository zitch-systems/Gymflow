import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { daysAgoIso } from '@/lib/dates';
import { Stat } from '@/components/ui/stat';
import { EmptyState } from '@/components/ui/empty-state';
import { Repeat, Banknote, TrendingUp, TrendingDown, Receipt } from 'lucide-react';

const GRADS = [
  'linear-gradient(135deg, #11d18b, #07a86c)',
  'linear-gradient(135deg, #4080ff, #2a5cc0)',
  'linear-gradient(135deg, #a8d92e, #6a9c00)',
  'linear-gradient(135deg, #ffb020, #cc8a10)',
  'linear-gradient(135deg, #b67bf3, #7c45c0)',
  'linear-gradient(135deg, #ff4560, #cc2a40)',
];
const gradFor = (s: string) => GRADS[s.charCodeAt(0) % GRADS.length];

// Known plan colours mirror the prototype's revenue-by-plan legend; anything
// else falls back to muted so a new plan tier still renders sensibly.
const PLAN_META: Record<string, { label: string; color: string }> = {
  scale: { label: 'Scale', color: '#11d18b' },
  growth: { label: 'Growth', color: '#4080ff' },
  starter: { label: 'Starter', color: '#c6f24e' },
};

const planLabel = (key: string) =>
  PLAN_META[key]?.label ?? (key === 'other' ? 'Other' : key.charAt(0).toUpperCase() + key.slice(1));

const STATUS_LABEL: Record<string, string> = {
  successful: 'Settled',
  failed: 'Failed',
  pending: 'Pending',
  refunded: 'Refunded',
};

export default async function SuperadminRevenuePage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  // RLS grants platform_admins cross-gym read; the anon client is enough.
  const admin = await createClient();

  const now = new Date();
  const since30 = daysAgoIso(30);
  const since60 = daysAgoIso(60);
  const since365 = daysAgoIso(365);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthLabel = now.toLocaleDateString('en-NG', { month: 'long', timeZone: 'UTC' });

  const [
    { data: pay365 },
    { data: gymsForPlans },
    { count: churnCount },
    { data: settlements },
  ] = await Promise.all([
    // Successful platform fees for the trailing year. Ordered newest-first so
    // that if PostgREST caps the row count, recent months (which drive MRR and
    // this-month totals) stay complete and only the far end of the chart thins.
    admin
      .from('platform_payments')
      .select('amount, created_at, plan')
      .eq('payment_status', 'successful')
      .gte('created_at', since365)
      .order('created_at', { ascending: false })
      .limit(5000),
    admin.from('gyms').select('subscription_plan').limit(2000),
    admin
      .from('gyms')
      .select('id', { count: 'exact', head: true })
      .in('subscription_status', ['suspended', 'terminated', 'cancelled'])
      .gte('updated_at', since30),
    admin
      .from('platform_payments')
      .select('amount, created_at, payment_status, plan, gym_id, gyms:gym_id(name, slug)')
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  // ── Headline aggregates, all derived from the single 365-day pull ──────────
  const ms30 = Date.parse(since30);
  const ms60 = Date.parse(since60);
  const msMonth = Date.parse(monthStart);

  let mrr30 = 0;
  let prev30 = 0;
  let processedMonth = 0;
  const planRev = new Map<string, number>();
  const revByMonth = new Map<string, number>();

  for (const p of pay365 ?? []) {
    if (!p.created_at) continue;
    const t = Date.parse(p.created_at);
    const amt = Number(p.amount ?? 0);

    if (t >= ms30) {
      mrr30 += amt;
      const key = p.plan ?? 'other';
      planRev.set(key, (planRev.get(key) ?? 0) + amt);
    } else if (t >= ms60) {
      prev30 += amt;
    }
    if (t >= msMonth) processedMonth += amt;

    const d = new Date(p.created_at);
    const mKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    revByMonth.set(mKey, (revByMonth.get(mKey) ?? 0) + amt);
  }

  const arr = mrr30 * 12;
  const mom = prev30 > 0 ? Math.round(((mrr30 - prev30) / prev30) * 100) : null;

  // Gyms-per-plan + total, for the by-plan panel and the churn rate.
  const planGyms = new Map<string, number>();
  for (const g of gymsForPlans ?? []) {
    const key = g.subscription_plan ?? 'other';
    planGyms.set(key, (planGyms.get(key) ?? 0) + 1);
  }
  const totalGyms = (gymsForPlans ?? []).length;
  const churned = churnCount ?? 0;
  const churnPct = totalGyms > 0 ? Math.round((churned / totalGyms) * 1000) / 10 : 0;

  const planRows = [...new Set([...planRev.keys(), ...planGyms.keys()])]
    .map((key) => ({
      key,
      label: planLabel(key),
      color: PLAN_META[key]?.color ?? 'var(--gf-text-muted)',
      gyms: planGyms.get(key) ?? 0,
      rev: planRev.get(key) ?? 0,
    }))
    .sort((a, b) => b.rev - a.rev);

  // Trailing-12-month MRR series for the bar chart (oldest → newest).
  const monthSeries = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return {
      key,
      label: d.toLocaleDateString('en-NG', { month: 'short', timeZone: 'UTC' }),
      amount: revByMonth.get(key) ?? 0,
    };
  });
  const monthMax = Math.max(1, ...monthSeries.map((m) => m.amount));
  const mrrSpark = monthSeries.map((m) => m.amount);

  const settleRows = (settlements ?? []).map((s, i) => {
    const g = Array.isArray(s.gyms) ? s.gyms[0] : s.gyms;
    const status = (s.payment_status as string | null) ?? 'pending';
    return {
      id: `${s.created_at ?? i}-${s.gym_id ?? i}`,
      name: g?.name ?? '—',
      slug: g?.slug ?? '',
      plan: s.plan ? planLabel(s.plan) : '—',
      status,
      date: s.created_at,
      amount: Number(s.amount ?? 0),
    };
  });

  const subtitle = [
    `${fmtNaira(mrr30)} MRR`,
    mom != null ? `${mom >= 0 ? '+' : ''}${mom}% MoM` : null,
    `${fmtNaira(processedMonth)} processed in ${monthLabel}`,
    `${churnPct}% churn`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Revenue</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <section className="kpis">
        <Stat
          label="MRR (30d platform fees)"
          value={fmtNaira(mrr30)}
          accent="emerald"
          icon={Repeat}
          spark={mrrSpark}
          delta={mom != null ? { dir: mom >= 0 ? 'up' : 'down', value: `${mom >= 0 ? '+' : ''}${mom}%` } : undefined}
        />
        <Stat label={`Processed in ${monthLabel}`} value={fmtNaira(processedMonth)} accent="lime" icon={Banknote} />
        <Stat label="ARR (run-rate)" value={fmtNaira(arr)} accent="blue" icon={TrendingUp} />
        <Stat label="Churn (30d)" value={`${churnPct}%`} accent="rose" icon={TrendingDown} />
      </section>

      <section className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>MRR growth</h3>
                <div className="sub">Trailing 12 months · {fmtNaira(monthSeries.reduce((a, m) => a + m.amount, 0))} collected</div>
              </div>
            </div>
            <div className="chart" role="img" aria-label={`Monthly platform revenue, ${fmtNaira(monthSeries.reduce((a, m) => a + m.amount, 0))} over 12 months`}>
              {monthSeries.map((m) => (
                <div key={m.key} className="bar-col">
                  <div className={`bar${m.amount === 0 ? ' muted' : ''}`} style={{ height: `${Math.round((m.amount / monthMax) * 100)}%` }} title={`${m.label}: ${fmtNaira(m.amount)}`} />
                  <span className="bar-lbl">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Revenue by plan</h3>
                <div className="sub">{planRows.reduce((s, p) => s + p.gyms, 0)} gyms across {planRows.length} plan{planRows.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            {planRows.length > 0 ? (
              <div>
                {planRows.map((p) => (
                  <div key={p.key} className="act-row">
                    <div className="ic" style={{ background: 'transparent' }} aria-hidden>
                      <span style={{ width: 14, height: 14, borderRadius: 4, background: p.color, display: 'inline-block' }} />
                    </div>
                    <div className="m">
                      <strong>{p.label}</strong>
                      <small>{p.gyms} gym{p.gyms === 1 ? '' : 's'}</small>
                    </div>
                    <span className="t naira" style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 800, fontSize: '0.95rem' }}>{fmtNaira(p.rev)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Receipt} title="No revenue yet" message="Plan revenue appears here as gyms subscribe." />
            )}
          </div>
        </div>
      </section>

      <div className="panel">
        <div className="panel-h">
          <div>
            <h3>Recent settlements</h3>
            <div className="sub">Last 12 platform-fee transactions</div>
          </div>
        </div>
        {settleRows.length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Gym</th>
                <th>Plan</th>
                <th>Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {settleRows.map((r) => {
                const success = r.status === 'successful';
                const pending = r.status === 'pending';
                const badge = success
                  ? { cls: 'gf-badge-success', label: 'Settled' }
                  : pending
                    ? { cls: 'gf-badge-warning', label: 'Pending' }
                    : { cls: 'gf-badge-danger', label: STATUS_LABEL[r.status] ?? r.status };
                return (
                  <tr key={r.id}>
                    <td>
                      {r.slug ? (
                        <a
                          href={`https://${r.slug}.gymflow.ng/admin/dashboard`}
                          target="_blank"
                          rel="noreferrer"
                          className="gname"
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                          <span className="sq" style={{ background: gradFor(r.name) }}>{r.name.charAt(0).toUpperCase()}</span>
                          <div><strong>{r.name}</strong><small>{r.slug}.gymflow.ng</small></div>
                        </a>
                      ) : (
                        <strong>{r.name}</strong>
                      )}
                    </td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{r.plan}</td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{fmtDate(r.date)}</td>
                    <td>
                      <span className={`gf-badge ${badge.cls}`}>
                        <span className="gf-dot" />
                        {badge.label}
                      </span>
                    </td>
                    <td className="naira" style={{ textAlign: 'right', color: success ? 'var(--gf-success)' : 'var(--gf-text)' }}>
                      {success ? '+' : ''}{fmtNaira(r.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={Receipt} title="No settlements yet" message="Platform-wide payments appear here as they settle." />
        )}
      </div>
    </div>
  );
}

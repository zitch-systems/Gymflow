import { Banknote, ArrowDownLeft, ArrowUpRight, CreditCard, Download, Filter } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';

export const metadata = { title: 'Wallet' };

const STATUS: Record<string, [string, string]> = {
  successful: ['gf-badge-success', 'Settled'],
  pending: ['gf-badge-info', 'Processing'],
  failed: ['gf-badge-danger', 'Failed'],
  refunded: ['gf-badge-warning', 'Refunded'],
};
const STATUS_VALUES = new Set(Object.keys(STATUS));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 'bank_transfer' → 'Bank transfer', 'card' → 'Card'.
function methodLabel(m: string): string {
  const s = m.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function AdminWallet({ searchParams }: { searchParams: Promise<{ status?: string; method?: string; from?: string; to?: string }> }) {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const sp = await searchParams;

  // Validated filters — status is whitelisted, dates are format-checked, method
  // is applied as a parameterized equality (no injection risk). Same param names
  // as the export route, so the CSV export can carry the exact filter.
  const status = sp.status && STATUS_VALUES.has(sp.status) ? sp.status : '';
  const method = (sp.method ?? '').trim();
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : '';
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : '';
  const hasFilters = Boolean(status || method || from || to);

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  // The transactions list honours the filters; the "this month" KPIs stay
  // month-scoped regardless (they summarise the month, not the current view).
  let txq = supabase.from('payments')
    .select('id, amount, payment_status, payment_date, created_at, payment_method, plan_id, member_id')
    .eq('gym_id', gym.id);
  if (status) txq = txq.eq('payment_status', status);
  if (method) txq = txq.eq('payment_method', method);
  if (from) txq = txq.gte('payment_date', `${from}T00:00:00Z`);
  if (to) txq = txq.lte('payment_date', `${to}T23:59:59Z`);
  txq = txq.order('payment_date', { ascending: false }).limit(60);

  const [{ data: rows }, { data: monthRows }, { data: methodRows }] = await Promise.all([
    txq,
    supabase.from('payments')
      .select('amount, payment_status, payment_date')
      .eq('gym_id', gym.id).gte('payment_date', monthStart.toISOString()),
    // Distinct payment methods this gym has used, to populate the filter.
    // DB-side DISTINCT via RPC (20260722_search_and_filters.sql) — the old
    // version fetched up to 1000 payment rows just to dedupe them here.
    // `as never`: the function postdates the generated types.
    supabase.rpc('gym_payment_methods' as never, { p_gym: gym.id } as never),
  ]);

  const collected = (monthRows ?? []).filter((p) => p.payment_status === 'successful').reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const pending = (monthRows ?? []).filter((p) => p.payment_status === 'pending').reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const failed = (monthRows ?? []).filter((p) => p.payment_status !== 'successful' && p.payment_status !== 'pending').reduce((s, p) => s + Number(p.amount ?? 0), 0);

  // Method options: the distinct set the gym actually uses, plus the current
  // selection if a URL pinned one that isn't in the set.
  const methodSet = new Set(((methodRows ?? []) as unknown as string[]).filter(Boolean));
  if (method) methodSet.add(method);
  const methodOptions = [...methodSet].sort();

  // Member names + plan names for the table.
  const memberIds = [...new Set((rows ?? []).map((r) => r.member_id).filter(Boolean) as string[])];
  const planIds = [...new Set((rows ?? []).map((r) => r.plan_id).filter(Boolean) as string[])];
  const [{ data: profiles }, { data: plans }] = await Promise.all([
    memberIds.length ? supabase.from('profiles').select('id, full_name, email').in('id', memberIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    planIds.length ? supabase.from('membership_plans').select('id, name').in('id', planIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));
  const planById = new Map((plans ?? []).map((p) => [p.id, p.name]));

  // Carry the active filters into the accounting CSV so the export matches
  // what's on screen.
  const exportParams = new URLSearchParams();
  if (status) exportParams.set('status', status);
  if (method) exportParams.set('method', method);
  if (from) exportParams.set('from', from);
  if (to) exportParams.set('to', to);
  const exportHref = `/admin/wallet/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`;

  const shown = (rows ?? []).length;

  return (
    <>
      <div className="page-h"><div><h1>Wallet</h1><p>{gym.name} · settlements via Paystack</p></div></div>

      <div className="wtop">
        <div className="balance">
          <small>Collected this month</small>
          <div className="amt">{fmtNaira(collected)}</div>
          <div className="sub">{fmtNaira(pending)} pending · {(monthRows ?? []).length} payment{(monthRows ?? []).length === 1 ? '' : 's'} this month</div>
          <div className="acts" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Banknote strokeWidth={1.9} size={16} />
            <span style={{ fontSize: '0.84rem', opacity: 0.92 }}>Paystack settles collections to your bank account automatically (T+1).</span>
          </div>
        </div>
        <div className="wstats">
          <div className="ws"><div className="ic" style={{ background: 'var(--gf-warning-soft)', color: 'var(--gf-warning)' }}><ArrowUpRight strokeWidth={1.9} /></div><div><div className="v">{fmtNaira(pending)}</div><div className="l">Pending settlement</div></div></div>
          <div className="ws"><div className="ic" style={{ background: 'var(--gf-danger-soft)', color: 'var(--gf-danger)' }}><ArrowDownLeft strokeWidth={1.9} /></div><div><div className="v">{fmtNaira(failed)}</div><div className="l">Failed this month</div></div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><h3>Transactions</h3><div className="sub">{hasFilters ? `${shown} match${shown === 1 ? 'es' : ''} your filters` : 'All settlements & payments'}</div></div>
          <a className="gf-btn gf-btn-secondary gf-btn-sm" href={exportHref} style={{ textDecoration: 'none', flexShrink: 0 }} title="Accounting-ready CSV with VAT breakdown (respects the filters below)">
            <Download strokeWidth={1.9} size={15} /> Accounting CSV
          </a>
        </div>

        {/* Server-side filter bar — a plain GET form so it works without JS and
            the URL is shareable/bookmarkable. Submits back to /admin/wallet. */}
        <form method="get" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, margin: '4px 0 16px' }}>
          <div className="gf-form-group" style={{ margin: 0, minWidth: 150 }}>
            <label className="gf-form-label" style={{ fontSize: '0.72rem' }}>Status</label>
            <select className="gf-select" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([value, [, label]]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="gf-form-group" style={{ margin: 0, minWidth: 150 }}>
            <label className="gf-form-label" style={{ fontSize: '0.72rem' }}>Method</label>
            <select className="gf-select" name="method" defaultValue={method}>
              <option value="">All methods</option>
              {methodOptions.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
            </select>
          </div>
          <div className="gf-form-group" style={{ margin: 0, minWidth: 140 }}>
            <label className="gf-form-label" style={{ fontSize: '0.72rem' }}>From</label>
            <input className="gf-input" type="date" name="from" defaultValue={from} max={to || undefined} />
          </div>
          <div className="gf-form-group" style={{ margin: 0, minWidth: 140 }}>
            <label className="gf-form-label" style={{ fontSize: '0.72rem' }}>To</label>
            <input className="gf-input" type="date" name="to" defaultValue={to} min={from || undefined} />
          </div>
          <button type="submit" className="gf-btn gf-btn-primary gf-btn-sm"><Filter strokeWidth={1.9} size={15} /> Apply</button>
          {hasFilters && <a href="/admin/wallet" className="gf-btn gf-btn-ghost gf-btn-sm" style={{ textDecoration: 'none' }}>Clear</a>}
        </form>

        {shown === 0 ? (
          <div className="empty"><div className="eic"><CreditCard strokeWidth={1.6} /></div>
            {hasFilters
              ? <><h3>No matching transactions</h3><p>No payments match these filters. Try widening the date range or clearing them.</p></>
              : <><h3>No payments yet</h3><p>Member renewals and purchases will show here.</p></>}
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              {/* Amount sits right after Description: on phones the table
                  scrolls horizontally, and the old order hid the one column a
                  payments list exists for. The Method column is dropped — it
                  duplicated the sub-label under every description. */}
              <thead><tr><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {(rows ?? []).map((p) => {
                  const st = STATUS[p.payment_status ?? ''] ?? ['gf-badge-neutral', p.payment_status ?? '—'];
                  const ok = p.payment_status === 'successful';
                  return (
                    <tr key={p.id}>
                      <td><div className="who"><span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)', border: 'none' }}><CreditCard strokeWidth={1.9} size={15} /></span><div><strong>{(p.plan_id && planById.get(p.plan_id)) || 'Payment'} · {p.member_id ? nameById.get(p.member_id) : '—'}</strong><small>{p.payment_method ?? 'Paystack'}</small></div></div></td>
                      <td className={`naira tx-amt ${ok ? 'in' : 'out'}`} style={{ textAlign: 'right' }}>{ok ? '+' : ''}{fmtNaira(Number(p.amount ?? 0))}</td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{fmtDate(p.payment_date ?? p.created_at)}</td>
                      <td><span className={`gf-badge ${st[0]}`}><span className="gf-dot" />{st[1]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

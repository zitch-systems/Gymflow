import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pagination } from '@/components/pagination';
import { sanitizeSearchTerm, ilikeOrFilter } from '@/lib/admin-search';
import { ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { CommissionEditor } from '@/components/superadmin/commission-editor';
import { sa } from '@/lib/superadmin-path';
import type { ReportingRpcClient } from '@/lib/reporting';

const GRADS = [
  'linear-gradient(135deg,#11d18b,#07a86c)', 'linear-gradient(135deg,#4080ff,#2a5cc0)',
  'linear-gradient(135deg,#a8d92e,#6a9c00)', 'linear-gradient(135deg,#ffb020,#cc8a10)',
  'linear-gradient(135deg,#b67bf3,#7c45c0)', 'linear-gradient(135deg,#11d18b,#4080ff)',
];
const STATUS: Record<string, [string, string]> = {
  active: ['gf-badge-success', 'Active'], trial: ['gf-badge-warning', 'Trial'],
  past_due: ['gf-badge-danger', 'Past due'], suspended: ['gf-badge-neutral', 'Suspended'],
  cancelled: ['gf-badge-neutral', 'Cancelled'],
};

// Real platform gym table — every gym (platform_admin RLS allows full read),
// with member counts. Server component; reused on overview + /gyms. The /gyms
// page passes `q`/`status` to filter; the overview omits them (no-op).
export async function GymTable({ limit = 50, q = '', status = 'all', page }: { limit?: number; q?: string; status?: string; page?: number }) {
  const supabase = await createClient();
  const needle = sanitizeSearchTerm(q);
  let query = supabase.from('gyms')
    .select('id, name, slug, city, status, subscription_status, subscription_plan, platform_commission_pct, platform_commission_mode, platform_commission_fixed_amount, paystack_subaccount_code', { count: 'exact' });
  // Apply filters before limiting rows, so an older gym is still searchable.
  if (status === 'trial') query = query.or('subscription_status.eq.trial,subscription_status.is.null');
  else if (status !== 'all') query = query.eq('subscription_status', status);
  if (needle) query = query.or(ilikeOrFilter(['name', 'slug', 'city'], needle));
  const offset = ((page ?? 1) - 1) * limit;
  const { data: allGyms, error, count } = await query
    .order('created_at', { ascending: false }).order('id')
    .range(offset, offset + limit - 1);
  if (error) throw new Error('Could not load gyms. Please retry.');
  const gyms = allGyms ?? [];
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  if (page && page > lastPage) {
    const params = new URLSearchParams({ ...(q && { q }), ...(status !== 'all' && { f: status }), ...(lastPage > 1 && { page: String(lastPage) }) });
    redirect(sa(`/gyms?${params}`));
  }

  const ids = gyms.map((g) => g.id);
  const countRes = ids.length
    ? await (supabase as unknown as ReportingRpcClient).rpc('platform_gym_member_counts', { p_gym_ids: ids })
    : { data: [] as unknown[], error: null };
  if (countRes.error) throw new Error(`platform_gym_member_counts failed: ${countRes.error.message}`);
  const countRows = Array.isArray(countRes.data) ? countRes.data : [];
  const memberCount = new Map(countRows.map((value) => {
    const row = value as { gym_id?: unknown; member_count?: unknown };
    if (typeof row.gym_id !== 'string') throw new Error('platform_gym_member_counts returned an invalid gym id');
    const count = Number(row.member_count);
    if (!Number.isFinite(count)) throw new Error('platform_gym_member_counts returned an invalid count');
    return [row.gym_id, count] as const;
  }));

  if (gyms.length === 0) {
    return needle || status !== 'all'
      ? <div className="empty"><div className="eic" /><h3>No matching gyms</h3><p>Try a different search or filter.</p></div>
      : <div className="empty"><div className="eic" /><h3>No gyms yet</h3><p>Onboard a gym to see it here.</p></div>;
  }

  return (
    <>
    <div className="tbl-scroll">
      <table className="gt">
        <thead><tr><th>Gym</th><th>Plan</th><th>Members</th><th>Commission</th><th>Status</th><th style={{ textAlign: 'right' }}>Subdomain</th><th /></tr></thead>
        <tbody>
          {gyms.map((g, i) => {
            const st = STATUS[g.subscription_status ?? 'trial'] ?? ['gf-badge-neutral', g.subscription_status ?? 'Trial'];
            // rowlink: the gym name and the trailing chevron are real links to
            // the detail page. Not a whole-row onclick — the row also holds the
            // commission input and the subdomain link, and a row handler would
            // swallow clicks meant for those (and be unreachable by keyboard).
            return (
              <tr key={g.id} className="rowlink">
                <td>
                  <Link href={sa(`/gyms/${g.id}`)} className="gname">
                    <span className="sq" style={{ background: GRADS[i % GRADS.length] }}>{g.name.charAt(0).toUpperCase()}</span>
                    <div><strong>{g.name}</strong><small>{g.slug}.gymflow.ng{g.city ? ` · ${g.city}` : ''}</small></div>
                  </Link>
                </td>
                <td style={{ textTransform: 'capitalize' }}>{g.subscription_plan ?? '—'}</td>
                <td>{memberCount.get(g.id) ?? 0}</td>
                <td><CommissionEditor gymId={g.id} pct={g.platform_commission_pct ?? 0} mode={g.platform_commission_mode === 'fixed' ? 'fixed' : 'percentage'} fixed={Number(g.platform_commission_fixed_amount ?? 0)} splitting={Boolean(g.paystack_subaccount_code)} /></td>
                <td><span className={`gf-badge ${st[0]}`}><span className="gf-dot" />{st[1]}</span></td>
                <td className="naira" style={{ textAlign: 'right' }}><a href={`/g/${g.slug}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} title="Open public page">{g.slug} ↗</a></td>
                <td style={{ textAlign: 'right', width: 36 }}>
                  <Link href={sa(`/gyms/${g.id}`)} className="row-chev" aria-label={`Open ${g.name}`}><ChevronRight strokeWidth={2} size={16} /></Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {page !== undefined && <Pagination basePath={sa('/gyms')} params={{ q: q || undefined, f: status !== 'all' ? status : undefined }} page={page} pageSize={limit} total={total} />}
    </>
  );
}

export { fmtNaira };

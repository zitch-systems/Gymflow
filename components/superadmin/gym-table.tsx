import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { CommissionEditor } from '@/components/superadmin/commission-editor';
import { sa } from '@/lib/superadmin-path';

const GRADS = [
  'linear-gradient(135deg,#11d18b,#07a86c)', 'linear-gradient(135deg,#4080ff,#2a5cc0)',
  'linear-gradient(135deg,#a8d92e,#6a9c00)', 'linear-gradient(135deg,#ffb020,#cc8a10)',
  'linear-gradient(135deg,#b67bf3,#7c45c0)', 'linear-gradient(135deg,#11d18b,#4080ff)',
];
const STATUS: Record<string, [string, string]> = {
  active: ['gf-badge-success', 'Active'], trial: ['gf-badge-warning', 'Trial'],
  past_due: ['gf-badge-danger', 'Past due'], suspended: ['gf-badge-neutral', 'Suspended'],
};

// Real platform gym table — every gym (platform_admin RLS allows full read),
// with member counts. Server component; reused on overview + /gyms. The /gyms
// page passes `q`/`status` to filter; the overview omits them (no-op).
export async function GymTable({ limit = 50, q = '', status = 'all' }: { limit?: number; q?: string; status?: string }) {
  const supabase = await createClient();
  const { data: allGyms } = await supabase
    .from('gyms')
    .select('id, name, slug, city, status, subscription_status, subscription_plan, platform_commission_pct, paystack_subaccount_code')
    .order('created_at', { ascending: false })
    .limit(limit);

  const needle = q.trim().toLowerCase();
  const gyms = (allGyms ?? []).filter((g) => {
    // Filter/badge on subscription_status (active/trial/past_due/cancelled);
    // null reads as "trial", matching the KPI counting on the gyms/overview pages.
    const bucket = g.subscription_status ?? 'trial';
    if (status !== 'all' && bucket !== status) return false;
    if (needle && !`${g.name} ${g.slug} ${g.city ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  const ids = gyms.map((g) => g.id);
  const { data: links } = ids.length
    ? await supabase.from('gym_member_links').select('gym_id').in('gym_id', ids).eq('is_active', true)
    : { data: [] as { gym_id: string | null }[] };
  const memberCount = new Map<string, number>();
  for (const l of links ?? []) if (l.gym_id) memberCount.set(l.gym_id, (memberCount.get(l.gym_id) ?? 0) + 1);

  if (gyms.length === 0) {
    return needle || status !== 'all'
      ? <div className="empty"><div className="eic" /><h3>No matching gyms</h3><p>Try a different search or filter.</p></div>
      : <div className="empty"><div className="eic" /><h3>No gyms yet</h3><p>Onboard a gym to see it here.</p></div>;
  }

  return (
    <div className="tbl-scroll">
      <table className="gt">
        <thead><tr><th>Gym</th><th>Plan</th><th>Members</th><th>Commission</th><th>Status</th><th style={{ textAlign: 'right' }}>Subdomain</th><th /></tr></thead>
        <tbody>
          {gyms.map((g, i) => {
            const st = STATUS[g.subscription_status ?? 'trial'] ?? ['gf-badge-success', g.subscription_status ?? 'Active'];
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
                <td><CommissionEditor gymId={g.id} pct={g.platform_commission_pct ?? 0} splitting={Boolean(g.paystack_subaccount_code)} /></td>
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
  );
}

export { fmtNaira };

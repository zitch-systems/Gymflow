import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime } from '@/lib/format';
import { PayoutApprovalRow } from './row-client';

export const metadata = { title: 'Payout approvals' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Platform-admin review queue for gym-owner-submitted bank changes. This page
// reads every tenant's bank PII via the service-role client (bypasses RLS), so
// it re-asserts requirePlatformAdmin() itself rather than trusting the layout
// gate alone — layouts aren't guaranteed to re-run on soft navigation, so a
// mid-session de-provisioned admin must be bounced here at the page level too.
export default async function PayoutApprovalsPage() {
  await requirePlatformAdmin();
  const db = createAdminClient();
  const { data } = await db
    .from('payout_change_requests' as never)
    .select('id, gym_id, bank_name, bank_code, account_number, account_name, name_matches, status, created_at, reject_reason, reviewed_at, gyms(name, slug, bank_name, account_number, account_name)')
    .in('status', ['pending', 'approved', 'rejected'])
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(200);

  type Row = {
    id: string; gym_id: string; bank_name: string; bank_code: string;
    account_number: string; account_name: string; name_matches: boolean; status: string;
    created_at: string; reject_reason: string | null; reviewed_at: string | null;
    gyms: { name: string; slug: string; bank_name: string | null; account_number: string | null; account_name: string | null } | null;
  };
  const rows = (data as unknown as Row[]) ?? [];
  const pending = rows.filter((r) => r.status === 'pending');
  const past = rows.filter((r) => r.status !== 'pending');

  return (
    <>
      <div className="page-h"><div><h1>Payout approvals</h1><p>Review gym bank-account changes. Approving writes the new bank to the gym and rebuilds the Paystack subaccount.</p></div></div>

      <div className="panel">
        <div className="panel-title">Pending review <span className="gf-badge gf-badge-warning" style={{ marginLeft: 8 }}>{pending.length}</span></div>
        {pending.length === 0
          ? <div className="panel-desc">Nothing pending — bank changes gyms submit will land here for approval.</div>
          : pending.map((r) => <PayoutApprovalRow key={r.id} r={r} />)}
      </div>

      {past.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Recently reviewed</div>
          <div className="tbl-scroll">
            <table style={{ width: '100%', fontSize: '0.86rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--gf-text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: '10px 8px' }}>Gym</th>
                  <th style={{ padding: '10px 8px' }}>New bank</th>
                  <th style={{ padding: '10px 8px' }}>Outcome</th>
                  <th style={{ padding: '10px 8px' }}>Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {past.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--gf-border)' }}>
                    <td style={{ padding: '10px 8px' }}>{r.gyms?.name ?? r.gym_id.slice(0, 8)}</td>
                    <td style={{ padding: '10px 8px' }}>{r.bank_name} · {r.account_name} · ••••{r.account_number.slice(-4)}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span className={`gf-badge ${r.status === 'approved' ? 'gf-badge-success' : 'gf-badge-danger'}`}>{r.status}</span>
                      {r.reject_reason && <span style={{ color: 'var(--gf-text-muted)', marginLeft: 8 }}>{r.reject_reason}</span>}
                    </td>
                    <td style={{ padding: '10px 8px', color: 'var(--gf-text-muted)' }}>{fmtDateTime(r.reviewed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

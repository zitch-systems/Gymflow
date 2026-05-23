import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getProfile, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';

export default async function SuperadminAuditPage() {
  await requireAuth();
  const profile = await getProfile();
  if (profile?.role !== 'platform_admin') redirect('/');

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('audit_logs')
    .select('id, created_at, action, table_name, record_id, gym_id, actor_id, new_values, gyms:gym_id(slug, name)')
    .order('created_at', { ascending: false })
    .limit(300);

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Platform audit log</h1>
          <p className="gf-page-subtitle">Last {rows?.length ?? 0} events across every gym.</p>
        </div>
        <Link href="/superadmin" className="gf-btn gf-btn-ghost gf-btn-sm">
          Back
        </Link>
      </header>

      <div className="gf-card">
        {rows && rows.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Gym</th>
                  <th>Action</th>
                  <th>Table</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const gym = Array.isArray(r.gyms) ? r.gyms[0] : r.gyms;
                  return (
                    <tr key={r.id}>
                      <td>{fmtDateTime(r.created_at)}</td>
                      <td>{gym?.name ?? '—'}</td>
                      <td>{r.action}</td>
                      <td className="gf-table-meta">{r.table_name}</td>
                      <td style={{ maxWidth: 320 }}>
                        <code style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {r.new_values ? JSON.stringify(r.new_values) : '—'}
                        </code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="gf-empty">
            <div className="gf-empty-icon">📜</div>
            <div className="gf-empty-title">No audit events yet</div>
          </div>
        )}
      </div>
    </div>
  );
}

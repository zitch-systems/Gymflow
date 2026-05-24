import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ShieldCheck } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminAuditPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('audit_logs')
    .select('id, created_at, action, table_name, record_id, actor_id, user_id, new_values, ip_address')
    .eq('gym_id', gym.id)
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="gf-page">
      <PageHeader title="Audit log" subtitle={`Last ${rows?.length ?? 0} events at ${gym.name}.`} />

      <Card>
        {rows && rows.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Table</th>
                  <th>Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.created_at)}</td>
                    <td>{r.action}</td>
                    <td className="gf-table-meta">{r.table_name}</td>
                    <td className="gf-table-meta" style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 }}>
                      {r.record_id?.slice(0, 8) ?? '—'}
                    </td>
                    <td style={{ maxWidth: 360 }}>
                      <code style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.new_values ? JSON.stringify(r.new_values) : '—'}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ShieldCheck} title="No audit events yet" />
        )}
      </Card>
    </div>
  );
}

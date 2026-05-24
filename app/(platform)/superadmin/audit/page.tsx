import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export default async function SuperadminAuditPage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('audit_logs')
    .select('id, created_at, action, table_name, record_id, gym_id, actor_id, new_values, gyms:gym_id(slug, name)')
    .order('created_at', { ascending: false })
    .limit(300);

  return (
    <div className="gf-page">
      <PageHeader
        title="Platform audit log"
        subtitle={`Last ${rows?.length ?? 0} events across every gym.`}
        actions={
          <ButtonLink href="/superadmin" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back
          </ButtonLink>
        }
      />

      <Card>
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
          <EmptyState icon={ShieldCheck} title="No audit events yet" />
        )}
      </Card>
    </div>
  );
}

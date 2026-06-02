import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { InviteInstructorForm } from './invite-form';
import { InstructorRowActions } from './row-actions';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { GraduationCap } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminInstructorsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const { data: links } = await supabase
    .from('gym_staff_links')
    .select('user_id, role, is_active, hire_date, joined_at, profiles:user_id(full_name, email, phone)')
    .eq('gym_id', gym.id)
    .eq('role', 'instructor')
    .order('joined_at', { ascending: false });

  return (
    <div className="gf-page">
      <PageHeader title="Instructors" subtitle={`${links?.length ?? 0} instructor(s) at ${gym.name}`} />

      <Card>
        <CardHeader title="Invite an instructor" />
        <InviteInstructorForm slug={slug} />
      </Card>

      <Card>
        <CardHeader title="Current instructors" />
        {links && links.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Hired</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const p = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles;
                  return (
                    <tr key={l.user_id ?? ''}>
                      <td style={{ fontWeight: 600 }}>{p?.full_name ?? '—'}</td>
                      <td>
                        <div>{p?.email ?? '—'}</div>
                        <div className="gf-table-meta">{p?.phone ?? '—'}</div>
                      </td>
                      <td>{l.hire_date ? fmtDate(l.hire_date) : l.joined_at ? fmtDate(l.joined_at) : '—'}</td>
                      <td>
                        <span className={`status-pill ${l.is_active ? 'on' : 'off'}`}>{l.is_active ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td>
                        {l.user_id && <InstructorRowActions slug={slug} userId={l.user_id} active={!!l.is_active} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={GraduationCap} title="No instructors invited yet" />
        )}
      </Card>
    </div>
  );
}

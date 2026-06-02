import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { StaffCheckInForm } from './staff-checkin-form';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { ClipboardList } from 'lucide-react';
import { startOfTodayIso } from '@/lib/dates';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ member?: string }>;
};

export default async function StaffCheckInPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const startOfDay = startOfTodayIso();

  const { data: recent } = await supabase
    .from('check_ins')
    .select('id, member_id, checked_in_at, check_in_method')
    .eq('gym_id', gym.id)
    .gte('checked_in_at', startOfDay)
    .order('checked_in_at', { ascending: false })
    .limit(50);

  const memberIds = Array.from(new Set((recent ?? []).map((c) => c.member_id).filter(Boolean) as string[]));
  const profilesPromise =
    memberIds.length > 0
      ? supabase.from('profiles').select('id, full_name, email, phone').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null }> });
  const { data: profiles } = await profilesPromise;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="gf-page">
      <PageHeader title="Staff check-in" subtitle={`${gym.name} · today: ${recent?.length ?? 0}`} />

      <Card>
        <CardHeader title="Check in a member" />
        <StaffCheckInForm slug={slug} defaultMember={sp.member ?? ''} />
      </Card>

      <Card>
        <CardHeader title="Today's visits" />
        {recent && recent.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Member</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => {
                  const p = c.member_id ? profileById.get(c.member_id) : null;
                  return (
                    <tr key={c.id}>
                      <td>{fmtDateTime(c.checked_in_at)}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p?.full_name ?? c.member_id?.slice(0, 8) ?? '—'}</div>
                        <div className="gf-table-meta">{p?.email ?? p?.phone ?? '—'}</div>
                      </td>
                      <td>{c.check_in_method ?? 'manual'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="No visits today" />
        )}
      </Card>
    </div>
  );
}

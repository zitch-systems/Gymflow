import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { StaffCheckInForm } from './staff-checkin-form';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ member?: string }>;
};

export default async function StaffCheckInPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: recent } = await supabase
    .from('check_ins')
    .select('id, member_id, checked_in_at, check_in_method')
    .eq('gym_id', gym.id)
    .gte('checked_in_at', startOfDay.toISOString())
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
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Staff check-in</h1>
          <p className="gf-page-subtitle">{gym.name} · today: {recent?.length ?? 0}</p>
        </div>
      </header>

      <div className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Check in a member</h2>
        </header>
        <StaffCheckInForm slug={slug} defaultMember={sp.member ?? ''} />
      </div>

      <div className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Today&apos;s visits</h2>
        </header>
        {recent && recent.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
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
          <div className="gf-empty">
            <div className="gf-empty-icon">📋</div>
            <div className="gf-empty-title">No visits today</div>
          </div>
        )}
      </div>
    </div>
  );
}

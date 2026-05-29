import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ClassCreateForm, ClassDeleteButton } from './class-forms';
import { ExportAttendanceCsvButton } from './export-csv-button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { CalendarX } from 'lucide-react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminClassesPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time, room, class_id, is_active, classes(name, category, max_capacity, duration_minutes, instructor)')
    .eq('gym_id', gym.id)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  return (
    <div className="gf-page">
      <PageHeader
        title="Class schedule"
        subtitle={`${schedules?.length ?? 0} scheduled slot(s)`}
        actions={<ExportAttendanceCsvButton slug={slug} />}
      />

      <Card>
        <CardHeader title="Add a class" />
        <ClassCreateForm slug={slug} />
      </Card>

      <Card>
        <CardHeader title="Current schedule" />
        {schedules && schedules.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Room</th>
                  <th>Capacity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{cls?.name ?? '—'}</div>
                        <div className="gf-table-meta">
                          {cls?.category ?? '—'} · {cls?.instructor ?? '—'}
                        </div>
                      </td>
                      <td>{DAY_LABELS[s.day_of_week] ?? '—'}</td>
                      <td>
                        {s.start_time} – {s.end_time}
                      </td>
                      <td>{s.room ?? '—'}</td>
                      <td>{cls?.max_capacity ?? '—'}</td>
                      <td>{s.class_id && <ClassDeleteButton slug={slug} classId={s.class_id} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={CalendarX} title="No classes scheduled" message="Add a class above to publish it on the members' timetable." />
        )}
      </Card>
    </div>
  );
}

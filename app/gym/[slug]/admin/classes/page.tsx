import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ClassCreateForm, ClassDeleteButton } from './class-forms';
import { ExportAttendanceCsvButton } from './export-csv-button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { CalendarX, CalendarDays, LayoutGrid, Users, CalendarCheck } from 'lucide-react';

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

  const slots = schedules ?? [];
  const classOf = (s: (typeof slots)[number]) => (Array.isArray(s.classes) ? s.classes[0] : s.classes);
  const weeklySpots = slots.reduce((a, s) => a + (classOf(s)?.max_capacity ?? 0), 0);
  const classCount = new Set(slots.map((s) => classOf(s)?.name).filter(Boolean)).size;
  const dayCount = new Set(slots.map((s) => s.day_of_week)).size;

  return (
    <div className="gf-page">
      <PageHeader
        title="Class schedule"
        subtitle={`${schedules?.length ?? 0} scheduled slot(s)`}
        actions={<ExportAttendanceCsvButton slug={slug} />}
      />

      <StatGrid>
        <Stat label="Scheduled slots" value={slots.length} accent="emerald" icon={CalendarDays} />
        <Stat label="Classes" value={classCount} accent="blue" icon={LayoutGrid} />
        <Stat label="Weekly spots" value={weeklySpots} accent="purple" icon={Users} />
        <Stat label="Days / week" value={dayCount} accent="amber" icon={CalendarCheck} />
      </StatGrid>

      <Card>
        <CardHeader title="Add a class" />
        <ClassCreateForm slug={slug} />
      </Card>

      <Card>
        <CardHeader title="Current schedule" />
        {schedules && schedules.length > 0 ? (
          <div className="gf-table-wrap">
            <table role="table" className="gf-table gf-table-cards">
              <thead>
                <tr role="row">
                  <th>Class</th>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Room</th>
                  <th>Capacity</th>
                  <th />
                </tr>
              </thead>
              <tbody role="rowgroup">
                {schedules.map((s) => {
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  return (
                    <tr role="row" key={s.id}>
                      <td role="cell">
                        <div style={{ fontWeight: 600 }}>{cls?.name ?? '—'}</div>
                        <div className="gf-table-meta">
                          {cls?.category ?? '—'} · {cls?.instructor ?? '—'}
                        </div>
                      </td>
                      <td role="cell" data-label="Day">{DAY_LABELS[s.day_of_week] ?? '—'}</td>
                      <td role="cell" data-label="Time">
                        {s.start_time} – {s.end_time}
                      </td>
                      <td role="cell" data-label="Room">{s.room ?? '—'}</td>
                      <td role="cell" data-label="Capacity">{cls?.max_capacity ?? '—'}</td>
                      <td role="cell">{s.class_id && <ClassDeleteButton slug={slug} classId={s.class_id} />}</td>
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

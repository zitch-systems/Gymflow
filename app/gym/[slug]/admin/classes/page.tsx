import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ClassCreateForm, ClassDeleteButton } from './class-forms';

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
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Class schedule</h1>
          <p className="gf-page-subtitle">{schedules?.length ?? 0} scheduled slot(s)</p>
        </div>
      </header>

      <div className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Add a class</h2>
        </header>
        <ClassCreateForm slug={slug} />
      </div>

      <div className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Current schedule</h2>
        </header>
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
          <div className="gf-empty">
            <div className="gf-empty-icon">📅</div>
            <div className="gf-empty-title">No classes scheduled</div>
            <div className="gf-empty-text">Add a class above to publish it on the members&apos; timetable.</div>
          </div>
        )}
      </div>
    </div>
  );
}

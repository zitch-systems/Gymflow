import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarX } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function CoachTimetablePage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time, room, classes(name)')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  const byDay = new Map<number, typeof schedules>();
  (schedules ?? []).forEach((s) => {
    const list = byDay.get(s.day_of_week) ?? [];
    list.push(s);
    byDay.set(s.day_of_week, list);
  });

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">My timetable</h1>
          <p className="gf-page-subtitle">Classes assigned to you · read-only</p>
        </div>
        <Link href="/coach" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      {schedules && schedules.length > 0 ? (
        Array.from({ length: 7 }, (_, day) => {
          const rows = byDay.get(day) ?? [];
          if (rows.length === 0) return null;
          return (
            <div key={day}>
              <div className="m-sect-t">{DAY_LABELS[day]}</div>
              <div className="m-links">
                {rows.map((s) => {
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  return (
                    <div key={s.id} className="m-lc">
                      <div className="m-lc-m">
                        <strong>{cls?.name ?? 'Class'}</strong>
                        {s.room ? <small>{s.room}</small> : null}
                      </div>
                      <span className="m-lc-time">{s.start_time} – {s.end_time}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      ) : (
        <EmptyState icon={CalendarX} title="No classes assigned" message="A gym admin will assign classes to you." />
      )}
    </div>
  );
}

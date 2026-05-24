import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { BookClassButton } from './book-button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { CalendarX } from 'lucide-react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dateForNextDOW(targetDow: number): string {
  const today = new Date();
  const todayDow = today.getDay();
  const diff = (targetDow - todayDow + 7) % 7 || 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  return d.toISOString().split('T')[0];
}

type PageProps = { params: Promise<{ slug: string }> };

export default async function MemberClassesPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select(
      'id, day_of_week, start_time, end_time, room, class_id, classes(name, category, level, instructor, max_capacity, duration_minutes)',
    )
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  const scheduleIds = (schedules ?? []).map((s) => s.id);
  const { data: bookings } =
    scheduleIds.length > 0
      ? await supabase
          .from('class_bookings')
          .select('class_schedule_id, booking_date, status')
          .eq('member_id', user.id)
          .in('class_schedule_id', scheduleIds)
          .neq('status', 'cancelled')
      : { data: [] as Array<{ class_schedule_id: string | null; booking_date: string | null; status: string | null }> };

  const bookedKey = (schId: string, date: string) => `${schId}|${date}`;
  const bookedSet = new Set(
    (bookings ?? [])
      .filter((b) => b.class_schedule_id && b.booking_date)
      .map((b) => bookedKey(b.class_schedule_id!, b.booking_date!)),
  );

  const byDay: Record<number, NonNullable<typeof schedules>> = {};
  for (const s of schedules ?? []) {
    byDay[s.day_of_week] = byDay[s.day_of_week] ?? [];
    byDay[s.day_of_week].push(s);
  }

  return (
    <div className="gf-page">
      <PageHeader title="Classes" subtitle="Tap a class to book your spot." />

      {Object.keys(byDay).length === 0 ? (
        <Card>
          <EmptyState icon={CalendarX} title="No classes scheduled yet" message="Check back soon — staff publish the timetable here." />
        </Card>
      ) : (
        DAY_LABELS.map((label, dow) => {
          const slots = byDay[dow];
          if (!slots || slots.length === 0) return null;
          const date = dateForNextDOW(dow);
          return (
            <Card key={dow}>
              <CardHeader title={<>{label} <span className="gf-table-meta">({date})</span></>} />
              <ul className="gf-list">
                {slots.map((s) => {
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  const booked = bookedSet.has(bookedKey(s.id, date));
                  return (
                    <li key={s.id} className="gf-list-row class-row">
                      <div>
                        <div style={{ fontWeight: 600 }}>{cls?.name ?? 'Class'}</div>
                        <div className="gf-table-meta">
                          {s.start_time} – {s.end_time} · {cls?.instructor ?? 'TBA'} · {s.room ?? '—'}
                        </div>
                      </div>
                      <BookClassButton slug={slug} scheduleId={s.id} bookingDate={date} alreadyBooked={booked} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}

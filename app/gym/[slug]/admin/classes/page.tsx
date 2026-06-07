import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ClassCreateForm, ClassDeleteButton } from './class-forms';
import { ExportAttendanceCsvButton } from './export-csv-button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { CalendarX, CalendarDays, Ticket, Gauge, Hourglass } from 'lucide-react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function splitTime(t: string): { hm: string; ap: string } {
  const [hRaw, m = '00'] = t.split(':');
  const h = parseInt(hRaw, 10);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ d?: string }>;
};

export default async function AdminClassesPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const sp = await searchParams;
  const todayDow = new Date().getUTCDay();
  const dowFromQuery = sp.d ? Number.parseInt(sp.d, 10) : todayDow;
  const selectedDow = Number.isFinite(dowFromQuery) && dowFromQuery >= 0 && dowFromQuery <= 6 ? dowFromQuery : todayDow;

  const supabase = await createClient();
  const [{ data: schedules }, { data: bookings }] = await Promise.all([
    supabase
      .from('class_schedules')
      .select('id, day_of_week, start_time, end_time, room, class_id, is_active, classes(name, category, max_capacity, duration_minutes, instructor)')
      .eq('gym_id', gym.id)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true }),
    // Count "booked" bookings per schedule across all dates — used for the
    // capacity bars on each slot.
    supabase
      .from('class_bookings')
      .select('class_schedule_id')
      .eq('gym_id', gym.id)
      .eq('status', 'booked'),
  ]);

  const slots = schedules ?? [];
  const classOf = (s: (typeof slots)[number]) => (Array.isArray(s.classes) ? s.classes[0] : s.classes);

  // Bookings per schedule_id.
  const bookingsBySchedule = new Map<string, number>();
  for (const b of bookings ?? []) {
    if (!b.class_schedule_id) continue;
    bookingsBySchedule.set(b.class_schedule_id, (bookingsBySchedule.get(b.class_schedule_id) ?? 0) + 1);
  }

  // KPI metrics.
  const sessionCount = slots.length;
  const totalBookings = (bookings ?? []).length;
  let totalCap = 0;
  for (const s of slots) totalCap += classOf(s)?.max_capacity ?? 0;
  const avgFill = totalCap > 0 ? Math.round((totalBookings / totalCap) * 100) : 0;
  const waitlistedCount = 0; // Could query separately; left at 0 until we add the query.

  // Day strip — count classes per day for the chip subtext.
  const countByDay = new Map<number, number>();
  for (const s of slots) countByDay.set(s.day_of_week, (countByDay.get(s.day_of_week) ?? 0) + 1);

  const daySlots = slots.filter((s) => s.day_of_week === selectedDow);

  const dayHref = (d: number) => (d === todayDow ? '/admin/classes' : `/admin/classes?d=${d}`);

  return (
    <div className="gf-page">
      <PageHeader
        title="Classes"
        subtitle={`${sessionCount} session${sessionCount === 1 ? '' : 's'} this week · ${totalBookings} booking${totalBookings === 1 ? '' : 's'} · ${avgFill}% average fill`}
        actions={<ExportAttendanceCsvButton slug={slug} />}
      />

      <div className="adm-classes-kpis">
        <Stat label="Sessions / week" value={sessionCount} accent="emerald" icon={CalendarDays} />
        <Stat label="Bookings" value={totalBookings} accent="blue" icon={Ticket} />
        <Stat label="Avg fill rate" value={`${avgFill}%`} accent="purple" icon={Gauge} />
        <Stat label="On waitlists" value={waitlistedCount} accent="amber" icon={Hourglass} />
      </div>

      <div className="adm-day-strip" role="tablist" aria-label="Day of week">
        {DAY_ABBR.map((abbr, d) => {
          const n = countByDay.get(d) ?? 0;
          return (
            <Link
              key={d}
              href={dayHref(d)}
              role="tab"
              aria-selected={selectedDow === d}
              className={`adm-day${selectedDow === d ? ' on' : ''}`}
            >
              <span className="adm-day-name">{abbr}</span>
              <span className="adm-day-num">{d === todayDow ? new Date().getDate() : ''}</span>
              <span className="adm-day-count">{n} class{n === 1 ? '' : 'es'}</span>
            </Link>
          );
        })}
      </div>

      {daySlots.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarX}
            title="No classes that day"
            message="Add a class below to publish it on the members' timetable."
          />
        </Card>
      ) : (
        <div className="adm-cls-list">
          {daySlots.map((s) => {
            const cls = classOf(s);
            const booked = bookingsBySchedule.get(s.id) ?? 0;
            const capacity = cls?.max_capacity ?? 0;
            const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;
            const isFull = capacity > 0 && booked >= capacity;
            const warn = pct >= 90;
            const { hm, ap } = splitTime(s.start_time);
            return (
              <div key={s.id} className="adm-clx">
                <div className="adm-clx-tm">
                  <b>{hm}</b>
                  <span>{ap}</span>
                </div>
                <div className="adm-clx-info">
                  <strong>{cls?.name ?? 'Class'}</strong>
                  <small>{cls?.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}</small>
                </div>
                <div className="adm-clx-cap">
                  <div className="adm-clx-cap-lbl">
                    <span>{booked}/{capacity || '—'} booked</span>
                    <span>{capacity > 0 ? `${pct}%` : ''}</span>
                  </div>
                  <div className="adm-clx-cap-track">
                    <div className={`adm-clx-cap-fill${warn ? ' warn' : ''}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="adm-clx-actions">
                  {isFull ? (
                    <span className="gf-badge gf-badge-danger" style={{ padding: '6px 11px' }}>Full</span>
                  ) : null}
                  {s.class_id ? <ClassDeleteButton slug={slug} classId={s.class_id} /> : null}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader title="Add a class" />
        <ClassCreateForm slug={slug} />
      </Card>
    </div>
  );
}

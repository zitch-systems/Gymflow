import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ClassAttendanceRow } from './class-attendance-row';
import { SessionAttendanceRow } from './session-attendance-row';
import { ScheduleSessionForm } from './schedule-session-form';
import { Stat } from '@/components/ui/stat';
import { CalendarCheck, Users, ClipboardCheck, UserPlus } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoachAttendancePage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dow = now.getDay();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  // Today's class schedules I teach
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, start_time, end_time, room, class_id, classes(name)')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .eq('day_of_week', dow)
    .eq('is_active', true)
    .order('start_time', { ascending: true });

  const scheduleIds = (schedules ?? []).map((s) => s.id);
  const { data: bookings } = scheduleIds.length
    ? await supabase
        .from('class_bookings')
        .select('id, class_schedule_id, member_id, checked_in, status, profiles:member_id(full_name, email)')
        .in('class_schedule_id', scheduleIds)
        .eq('booking_date', today)
    : { data: [] };

  const bookingsBySchedule = new Map<string, typeof bookings>();
  (bookings ?? []).forEach((b) => {
    if (!b.class_schedule_id) return;
    const list = bookingsBySchedule.get(b.class_schedule_id) ?? [];
    list.push(b);
    bookingsBySchedule.set(b.class_schedule_id, list);
  });

  // Today's 1-on-1 sessions
  const { data: sessions } = await supabase
    .from('instructor_sessions')
    .select('id, scheduled_at, duration_minutes, status, notes, member_id, profiles:member_id(full_name, email)')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .gte('scheduled_at', dayStart)
    .lt('scheduled_at', dayEnd)
    .order('scheduled_at', { ascending: true });

  // Active subscribers — eligible members for new sessions
  const { data: subs } = await supabase
    .from('instructor_subscriptions')
    .select('member_id, profiles:member_id(full_name, email)')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .eq('status', 'active')
    .gte('end_date', today);

  const eligible = new Map<string, string>();
  (subs ?? []).forEach((s) => {
    if (!s.member_id) return;
    const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
    eligible.set(s.member_id, p?.full_name ?? p?.email ?? 'Member');
  });

  const totalClassesToday = schedules?.length ?? 0;
  const totalBookings = (bookings ?? []).length;
  const totalSessions = sessions?.length ?? 0;
  const eligibleCount = eligible.size;

  return (
    <div className="gf-page">
      <header className="hdr">
        <div>
          <h1>Attendance</h1>
          <p>{totalClassesToday} class{totalClassesToday === 1 ? '' : 'es'} · {totalSessions} PT today</p>
        </div>
        <Link href="/coach/profile" className="icon-btn" aria-label="Profile">
          <span>C</span>
        </Link>
      </header>

      <section className="kpis">
        <Stat label="Group classes today" value={totalClassesToday} accent="emerald" icon={CalendarCheck} />
        <Stat label="Bookings (group)" value={totalBookings} accent="blue" icon={Users} />
        <Stat label="PT sessions today" value={totalSessions} accent="lime" icon={ClipboardCheck} />
        <Stat label="Eligible clients" value={eligibleCount} accent="amber" icon={UserPlus} />
      </section>

      <div className="panel">
        <div className="panel-h">
          <div>
            <h3>Group classes today</h3>
            <div className="sub">Mark attendance for each booked member</div>
          </div>
        </div>
        {schedules && schedules.length > 0 ? (
          schedules.map((s) => {
            const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
            const rows = bookingsBySchedule.get(s.id) ?? [];
            return (
              <div key={s.id} style={{ borderTop: '1px solid var(--gf-border)' }}>
                <div style={{ padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 700, fontSize: '0.95rem' }}>{cls?.name ?? 'Class'}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--gf-text-muted)' }}>{s.start_time} – {s.end_time}{s.room ? ` · ${s.room}` : ''}</div>
                  </div>
                  <span className="gf-badge gf-badge-neutral">{rows.length} booked</span>
                </div>
                {rows.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {rows.map((b) => {
                      const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles;
                      return (
                        <ClassAttendanceRow
                          key={b.id}
                          slug={slug}
                          bookingId={b.id}
                          name={p?.full_name ?? p?.email ?? 'Member'}
                          attended={!!b.checked_in}
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <div className="sub" style={{ padding: '8px 0' }}>No bookings.</div>
                )}
              </div>
            );
          })
        ) : (
          <div className="sub" style={{ padding: '4px 0' }}>No classes scheduled today.</div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <div>
            <h3>1-on-1 sessions today</h3>
            <div className="sub">Mark completed, no-show, or cancelled</div>
          </div>
        </div>
        {sessions && sessions.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sessions.map((s) => {
              const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
              return (
                <SessionAttendanceRow
                  key={s.id}
                  slug={slug}
                  sessionId={s.id}
                  name={p?.full_name ?? p?.email ?? 'Member'}
                  scheduledAt={s.scheduled_at}
                  duration={s.duration_minutes ?? 60}
                  status={(s.status ?? 'scheduled') as 'scheduled' | 'completed' | 'no_show' | 'cancelled'}
                />
              );
            })}
          </ul>
        ) : (
          <div className="sub" style={{ padding: '4px 0' }}>No 1-on-1 sessions today.</div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <div>
            <h3>Schedule a 1-on-1</h3>
            <div className="sub">Pick an active subscriber and set the slot</div>
          </div>
        </div>
        <ScheduleSessionForm slug={slug} eligible={Array.from(eligible.entries()).map(([id, name]) => ({ id, name }))} />
      </div>
    </div>
  );
}

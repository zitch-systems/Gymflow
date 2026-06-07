import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/empty-state';
import { Stat } from '@/components/ui/stat';
import { CalendarX, CalendarDays, Clock, Repeat } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function splitTime(t: string): { hm: string; ap: string } {
  const [hRaw, m = '00'] = t.split(':');
  const h = parseInt(hRaw, 10);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

function durationMinutes(start: string, end: string): number {
  const toM = (t: string) => { const [h, m = '0'] = t.split(':'); return parseInt(h, 10) * 60 + parseInt(m, 10); };
  return Math.max(0, toM(end) - toM(start));
}

export default async function CoachTimetablePage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time, room, classes(name, max_capacity)')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  const slots = schedules ?? [];
  const byDay = new Map<number, typeof slots>();
  for (const s of slots) {
    const list = byDay.get(s.day_of_week) ?? [];
    list.push(s);
    byDay.set(s.day_of_week, list);
  }

  const totalWeekly = slots.length;
  const totalCapacity = slots.reduce((s, x) => {
    const cls = Array.isArray(x.classes) ? x.classes[0] : x.classes;
    return s + (cls?.max_capacity ?? 0);
  }, 0);
  const totalHours = Math.round(slots.reduce((s, x) => s + durationMinutes(x.start_time, x.end_time), 0) / 60);
  const daysCovered = new Set(slots.map((s) => s.day_of_week)).size;

  return (
    <div className="gf-page">
      <header className="hdr">
        <div>
          <h1>Schedule</h1>
          <p>{totalWeekly} session{totalWeekly === 1 ? '' : 's'}/wk · {totalHours}h at {gym.name}</p>
        </div>
        <Link href="/coach/profile" className="icon-btn" aria-label="Profile">
          <span>C</span>
        </Link>
      </header>

      <section className="kpis">
        <Stat label="Sessions / week" value={totalWeekly} accent="emerald" icon={CalendarDays} />
        <Stat label="Coaching hours" value={`${totalHours}h`} accent="blue" icon={Clock} />
        <Stat label="Days / week" value={daysCovered} accent="lime" icon={Repeat} />
        <Stat label="Weekly spots" value={totalCapacity} accent="amber" icon={CalendarDays} />
      </section>

      {totalWeekly === 0 ? (
        <div className="panel">
          <EmptyState icon={CalendarX} title="No classes assigned" message="A gym admin will assign classes to you." />
        </div>
      ) : (
        <div className="adm-grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
          {Array.from({ length: 7 }, (_, dayIndex) => {
            const day = (dayIndex + 1) % 7; // Render Mon..Sun
            const rows = byDay.get(day) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={day} className="panel">
                <div className="panel-h">
                  <div>
                    <h3>{DAY_LABELS[day]}</h3>
                    <div className="sub">{DAY_ABBR[day]} · {rows.length} session{rows.length === 1 ? '' : 's'}</div>
                  </div>
                </div>
                <div className="cls">
                  {rows.map((s) => {
                    const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                    const { hm, ap } = splitTime(s.start_time);
                    return (
                      <div key={s.id} className="cls-row">
                        <span className="cls-time">{hm}<span style={{ marginLeft: 4, color: 'var(--gf-text-muted)', fontSize: '0.66rem' }}>{ap}</span></span>
                        <span className="cls-meta">
                          <strong>{cls?.name ?? 'Class'}</strong>
                          <small>{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{s.room ? ` · ${s.room}` : ''}</small>
                        </span>
                        {cls?.max_capacity ? <span className="cap-num">{cls.max_capacity} spots</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

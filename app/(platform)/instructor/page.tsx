import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getProfile, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { CalendarX, LogOut } from 'lucide-react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function splitTime(t: string): { hm: string; ap: string } {
  const [hRaw, m = '00'] = t.split(':');
  const h = parseInt(hRaw, 10);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

export default async function InstructorPage() {
  await requireAuth();
  const profile = await getProfile();
  if (profile?.role !== 'instructor') redirect('/');

  const supabase = await createClient();
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time, room, class_id, classes(name, gym_id, gyms(name, slug))')
    .eq('instructor_id', profile.id)
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
  const totalSessions = slots.length;
  const gyms = new Set(slots.map((s) => {
    const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
    const g = cls && (Array.isArray(cls.gyms) ? cls.gyms[0] : cls.gyms);
    return g?.name;
  }).filter(Boolean));

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Instructor portal</h1>
          <p>{profile.full_name ?? profile.email ?? 'Instructor'} · {totalSessions} session{totalSessions === 1 ? '' : 's'}/week across {gyms.size} gym{gyms.size === 1 ? '' : 's'}</p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={14} strokeWidth={1.75} />}>
            Sign out
          </Button>
        </form>
      </div>

      {totalSessions === 0 ? (
        <div className="panel">
          <EmptyState
            icon={CalendarX}
            title="No classes assigned yet"
            message="A gym admin will assign classes to you and they will appear here."
          />
        </div>
      ) : (
        <div className="adm-grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
          {Array.from({ length: 7 }, (_, dayIndex) => {
            const day = (dayIndex + 1) % 7;
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
                    const g = cls && (Array.isArray(cls.gyms) ? cls.gyms[0] : cls.gyms);
                    const { hm, ap } = splitTime(s.start_time);
                    return (
                      <div key={s.id} className="cls-row">
                        <span className="cls-time">{hm}<span style={{ marginLeft: 4, color: 'var(--gf-text-muted)', fontSize: '0.66rem' }}>{ap}</span></span>
                        <span className="cls-meta">
                          <strong>{cls?.name ?? 'Class'}</strong>
                          <small>
                            {g?.name ?? 'Gym'}
                            {s.start_time && s.end_time ? ` · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` : ''}
                            {s.room ? ` · ${s.room}` : ''}
                          </small>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ textAlign: 'center', marginTop: 24, color: 'var(--gf-text-muted)', fontSize: '0.8rem' }}>
        Member of multiple gyms? <Link href="/login" className="gf-link">Sign in</Link> with a different account to switch.
        {' · '}Profile joined: {fmtDate(profile.created_at)}
      </p>
    </div>
  );
}

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getProfile, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarX, LogOut } from 'lucide-react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function InstructorPage() {
  await requireAuth();
  const profile = await getProfile();
  if (profile?.role !== 'instructor') redirect('/');

  const supabase = await createClient();
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time, room, class_id, classes(name, gym_id, gyms(name))')
    .eq('instructor_id', profile.id)
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  return (
    <div className="gf-page">
      <PageHeader
        title="Instructor portal"
        subtitle={profile.full_name ?? profile.email ?? 'Instructor'}
        actions={
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={16} strokeWidth={1.75} />}>
              Sign out
            </Button>
          </form>
        }
      />

      <Card>
        <CardHeader title="Your schedule" />
        {schedules && schedules.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Gym</th>
                  <th>Class</th>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Room</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  const gym = cls && (Array.isArray(cls.gyms) ? cls.gyms[0] : cls.gyms);
                  return (
                    <tr key={s.id}>
                      <td>{gym?.name ?? '—'}</td>
                      <td>{cls?.name ?? '—'}</td>
                      <td>{DAY_LABELS[s.day_of_week] ?? '—'}</td>
                      <td>
                        {s.start_time} – {s.end_time}
                      </td>
                      <td>{s.room ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={CalendarX}
            title="No classes assigned yet"
            message="A gym admin will assign classes to you and they will appear here."
          />
        )}
      </Card>

      <p className="gf-form-hint" style={{ textAlign: 'center', marginTop: 24 }}>
        Member of multiple gyms? <Link href="/login">Sign in</Link> with a different account to switch.
      </p>
      <p className="gf-form-hint" style={{ textAlign: 'center', marginTop: 4 }}>
        Profile joined: {fmtDate(profile.created_at)}
      </p>
    </div>
  );
}

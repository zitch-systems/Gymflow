import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { AttendanceClient, type Session } from './attendance-client';

export const metadata = { title: 'Attendance · Instructor' };

export default async function CoachAttendance() {
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const { data: sessions } = await supabase
    .from('instructor_sessions')
    .select('id, scheduled_at, status, member_id')
    .eq('instructor_id', user.id).eq('gym_id', gym.id)
    .gte('scheduled_at', dayStart.toISOString()).lt('scheduled_at', dayEnd.toISOString())
    .order('scheduled_at', { ascending: true });

  const ids = [...new Set((sessions ?? []).map((s) => s.member_id).filter(Boolean) as string[])];
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  const rows: Session[] = (sessions ?? []).map((s) => {
    const nm = s.member_id ? (nameById.get(s.member_id) ?? 'Member') : 'Member';
    return { id: s.id, name: nm, initial: nm.charAt(0).toUpperCase(), status: s.status, time: new Date(s.scheduled_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false }) };
  });

  return (
    <>
      <div className="hdr"><h1>Attendance</h1><p>{new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })} · mark who showed up</p></div>
      <AttendanceClient sessions={rows} />
    </>
  );
}

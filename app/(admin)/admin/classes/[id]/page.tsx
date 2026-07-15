import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Users, Gauge, CalendarCheck, GraduationCap, MapPin, Clock, Pencil } from 'lucide-react';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { AttendanceButtons } from '@/components/admin/attendance-buttons';

export const metadata = { title: 'Class roster' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hm = (t?: string | null) => (t ? String(t).slice(0, 5) : '');

export default async function ClassRoster({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { gym, role } = await requireStaff();
  const canManage = (MANAGER_ROLES as readonly string[]).includes(role);
  const supabase = await createClient();

  const { data: sched } = await supabase.from('class_schedules').select('*').eq('id', id).eq('gym_id', gym.id).maybeSingle();
  if (!sched) notFound();

  const [{ data: cls }, { data: bookings }] = await Promise.all([
    sched.class_id ? supabase.from('classes').select('*').eq('id', sched.class_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('class_bookings').select('id, member_id, status, booking_date').eq('class_schedule_id', id).eq('gym_id', gym.id).order('booking_date', { ascending: false }),
  ]);

  const bks = bookings ?? [];
  const memberIds = [...new Set(bks.map((b) => b.member_id).filter(Boolean) as string[])];
  const { data: profiles } = memberIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', memberIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  const cap = cls?.max_capacity ?? 0;
  const active = bks.filter((b) => b.status !== 'cancelled');
  const attended = bks.filter((b) => b.status === 'attended').length;
  const fill = cap > 0 ? Math.min(100, Math.round((active.length / cap) * 100)) : 0;
  const className = cls?.name ?? 'Class';

  const STATS = [
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: `${active.length}/${cap || '—'}`, lbl: 'Booked' },
    { icon: Gauge, fg: '#4080ff', bg: '#4080ff1f', val: cap > 0 ? `${fill}%` : '—', lbl: 'Fill rate' },
    { icon: CalendarCheck, fg: '#a8d92e', bg: '#c6f24e24', val: String(attended), lbl: 'Attended' },
    { icon: Clock, fg: '#ffb020', bg: '#ffb0201f', val: `${cls?.duration_minutes ?? '—'}m`, lbl: 'Duration' },
  ];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Link href="/admin/classes" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to classes</Link>
        {canManage && (
          <Link href={`/admin/classes/${id}/edit`} className="gf-btn gf-btn-secondary gf-btn-sm" style={{ textDecoration: 'none' }}><Pencil strokeWidth={1.9} size={15} /> Edit class</Link>
        )}
      </div>

      <div className="mdh">
        <span className="gf-avatar gf-avatar-xl">{className.charAt(0).toUpperCase()}</span>
        <div className="mdh-id">
          <div className="mdh-name"><h1>{className}</h1>{cls?.category && <span className="gf-badge gf-badge-brand">{cls.category}</span>}</div>
          <div className="mdh-meta">
            <span><Clock strokeWidth={1.8} size={14} /> {DOW[sched.day_of_week] ?? ''} · {hm(sched.start_time)}{sched.end_time ? `–${hm(sched.end_time)}` : ''}</span>
            {cls?.instructor && <span><GraduationCap strokeWidth={1.8} size={14} /> {cls.instructor}</span>}
            {sched.room && <span><MapPin strokeWidth={1.8} size={14} /> {sched.room}</span>}
          </div>
        </div>
      </div>

      <section className="kpis">
        {STATS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <div className="panel">
        <div className="panel-h"><h3>Roster</h3><span className="sub">{active.length} booked{cap ? ` of ${cap}` : ''}</span></div>
        {bks.length === 0 ? (
          <div className="empty sm"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No bookings yet</h3><p>Members who book this session appear here.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Member</th><th>Status</th><th style={{ textAlign: 'right' }}>Booked for</th></tr></thead>
            <tbody>
              {bks.map((b) => {
                const nm = b.member_id ? (nameById.get(b.member_id) ?? 'Member') : 'Member';
                return (
                  <tr key={b.id}>
                    <td><div className="who"><span className="gf-avatar gf-avatar-sm">{nm.charAt(0).toUpperCase()}</span><div><strong>{b.member_id ? <Link href={`/admin/members/${b.member_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{nm}</Link> : nm}</strong></div></div></td>
                    <td><AttendanceButtons bookingId={b.id} scheduleId={id} status={b.status ?? 'booked'} /></td>
                    <td style={{ textAlign: 'right', color: 'var(--gf-text-secondary)' }}>{fmtDate(b.booking_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { ClassForm, type ClassFormValues } from '@/components/admin/class-form';

export const metadata = { title: 'Edit class' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function EditClass({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { gym } = await requireStaff(MANAGER_ROLES);
  const supabase = await createClient();

  const { data: sched } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time, room, class_id')
    .eq('id', id).eq('gym_id', gym.id).maybeSingle();
  if (!sched) notFound();

  const { data: cls } = sched.class_id
    ? await supabase.from('classes').select('id, name, category, max_capacity, duration_minutes').eq('id', sched.class_id).eq('gym_id', gym.id).maybeSingle()
    : { data: null };
  if (!cls) notFound();

  const klass: ClassFormValues = {
    classId: cls.id,
    scheduleId: sched.id,
    name: cls.name ?? '',
    category: cls.category ?? null,
    max_capacity: cls.max_capacity ?? null,
    duration_minutes: cls.duration_minutes ?? null,
    day_of_week: sched.day_of_week ?? 1,
    start_time: sched.start_time ?? null,
    end_time: sched.end_time ?? null,
    room: sched.room ?? null,
  };

  return (
    <>
      <Link href={`/admin/classes/${id}`} className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to roster</Link>
      <div className="page-h"><div><h1>Edit class</h1><p>Update {klass.name || 'this class'} and its weekly time slot.</p></div></div>
      <div className="panel" style={{ maxWidth: 720 }}><ClassForm klass={klass} /></div>
    </>
  );
}

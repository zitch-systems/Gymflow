import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BookClassButton } from './book-button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { CalendarX } from 'lucide-react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Split an "HH:MM[:SS]" time into a display hour:min and an AM/PM marker for
// the class-card time block (design-system .cls-tm pattern).
function splitTime(t: string): { hm: string; ap: string } {
  const [hRaw, m = '00'] = t.split(':');
  const h = parseInt(hRaw, 10);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

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
  const bookedKey = (schId: string, date: string) => `${schId}|${date}`;

  // The member's own bookings (RLS scopes this to them).
  const { data: bookings } =
    scheduleIds.length > 0
      ? await supabase
          .from('class_bookings')
          .select('id, class_schedule_id, booking_date, status')
          .eq('member_id', user.id)
          .in('class_schedule_id', scheduleIds)
          .neq('status', 'cancelled')
      : { data: [] as Array<{ id: string; class_schedule_id: string | null; booking_date: string | null; status: string | null }> };

  const myBooking = new Map<string, { id: string; status: string }>();
  for (const b of bookings ?? []) {
    if (b.class_schedule_id && b.booking_date && b.id) {
      myBooking.set(bookedKey(b.class_schedule_id, b.booking_date), { id: b.id, status: b.status ?? 'booked' });
    }
  }

  // Confirmed-booking counts across all members (counts only, no PII) via service role —
  // RLS otherwise hides other members' rows from a member session. Best-effort:
  // if the service-role key is unset/unavailable, fall back to no capacity badges
  // rather than crashing the page (booking itself still enforces capacity).
  const confirmedCount = new Map<string, number>();
  if (scheduleIds.length > 0) {
    try {
      const admin = createAdminClient();
      const { data: allBooked } = await admin
        .from('class_bookings')
        .select('class_schedule_id, booking_date')
        .eq('gym_id', gym.id)
        .eq('status', 'booked')
        .in('class_schedule_id', scheduleIds);
      for (const b of allBooked ?? []) {
        if (!b.class_schedule_id || !b.booking_date) continue;
        const k = bookedKey(b.class_schedule_id, b.booking_date);
        confirmedCount.set(k, (confirmedCount.get(k) ?? 0) + 1);
      }
    } catch (e) {
      console.warn('[GF classes] capacity counts unavailable:', (e as Error).message);
    }
  }

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
            <div key={dow} className="cls-day-group">
              <div className="cls-day-title">{label} <span>{date}</span></div>
              {slots.map((s) => {
                const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                const key = bookedKey(s.id, date);
                const mine = myBooking.get(key);
                const capacity = cls?.max_capacity ?? null;
                const taken = confirmedCount.get(key) ?? 0;
                const spotsLeft = capacity != null ? Math.max(0, capacity - taken) : null;
                const isFull = capacity != null && taken >= capacity;
                const { hm, ap } = splitTime(s.start_time);
                return (
                  <div key={s.id} className="cls-card">
                    <div className="cls-tm">
                      <b>{hm}</b>
                      <span>{ap}</span>
                    </div>
                    <div className="cls-info">
                      <strong>{cls?.name ?? 'Class'}</strong>
                      <small>
                        {cls?.instructor ?? 'TBA'}
                        {s.room ? ` · ${s.room}` : ''}
                        {capacity != null ? ` · ${taken}/${capacity} booked` : ''}
                      </small>
                    </div>
                    {capacity != null && !mine && (
                      <span className={`gf-badge ${isFull ? 'gf-badge-warning' : 'gf-badge-neutral'}`}>
                        {isFull ? 'Full' : `${spotsLeft} left`}
                      </span>
                    )}
                    <BookClassButton
                      slug={slug}
                      scheduleId={s.id}
                      bookingDate={date}
                      memberStatus={(mine?.status as 'booked' | 'waitlisted' | undefined) ?? null}
                      bookingId={mine?.id ?? null}
                      isFull={isFull}
                    />
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}

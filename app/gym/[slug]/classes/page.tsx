import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BookClassButton } from './book-button';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarX, Bell } from 'lucide-react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function splitTime(t: string): { hm: string; ap: string } {
  const [hRaw, m = '00'] = t.split(':');
  const h = parseInt(hRaw, 10);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { hm: `${h12}:${m.padStart(2, '0')}`, ap };
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; d?: string }>;
};

export default async function MemberClassesPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = sp.tab === 'bookings' ? 'bookings' : 'cal';

  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();

  const { count: unreadCountRaw } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('gym_id', gym.id)
    .eq('is_read', false);
  const unreadCount = unreadCountRaw ?? 0;

  // ── Week strip — Monday-anchored, 7 days from today's Monday.
  const today = new Date();
  const todayIso = isoDate(today);
  const monDow = (today.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - monDow);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      iso: isoDate(d),
      dom: d.getDate(),
      dowShort: SHORT[d.getDay()],
      dow: d.getDay(),
    };
  });

  const selectedIso = sp.d && weekDays.find((w) => w.iso === sp.d) ? sp.d! : todayIso;
  const selectedDate = new Date(selectedIso);
  const selectedDow = selectedDate.getDay();

  // All schedules — enough info for the strip's dot markers + the day list.
  const { data: schedules } = await supabase
    .from('class_schedules')
    .select(
      'id, day_of_week, start_time, end_time, room, class_id, classes(name, category, level, instructor, max_capacity, duration_minutes)',
    )
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .order('start_time', { ascending: true });

  const hasOnDow = new Set((schedules ?? []).map((s) => s.day_of_week));
  const slots = (schedules ?? []).filter((s) => s.day_of_week === selectedDow);
  const scheduleIds = (schedules ?? []).map((s) => s.id);
  const bookedKey = (schId: string, date: string) => `${schId}|${date}`;

  // Member's own bookings — RLS-scoped to them.
  const { data: bookings } =
    scheduleIds.length > 0
      ? await supabase
          .from('class_bookings')
          .select('id, class_schedule_id, booking_date, status, classes:class_schedules(start_time, end_time, room, class_id)')
          .eq('member_id', user.id)
          .in('class_schedule_id', scheduleIds)
          .neq('status', 'cancelled')
          .order('booking_date', { ascending: true })
      : { data: [] as Array<{ id: string; class_schedule_id: string | null; booking_date: string | null; status: string | null; classes: { start_time: string; end_time: string; room: string | null; class_id: string | null } | null }> };

  const myBooking = new Map<string, { id: string; status: string }>();
  for (const b of bookings ?? []) {
    if (b.class_schedule_id && b.booking_date && b.id) {
      myBooking.set(bookedKey(b.class_schedule_id, b.booking_date), { id: b.id, status: b.status ?? 'booked' });
    }
  }

  // Confirmed-count per (schedule, date) for capacity badges.
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
        confirmedCount.set(bookedKey(b.class_schedule_id, b.booking_date), (confirmedCount.get(bookedKey(b.class_schedule_id, b.booking_date)) ?? 0) + 1);
      }
    } catch (e) {
      console.warn('[GF classes] capacity counts unavailable:', (e as Error).message);
    }
  }

  // Bookings tab — class metadata via the class_schedules join above.
  const classIdsInBookings = [...new Set((bookings ?? []).map((b) => b.classes?.class_id).filter((x): x is string => Boolean(x)))];
  const { data: classMetas } = classIdsInBookings.length > 0
    ? await supabase.from('classes').select('id, name, instructor').in('id', classIdsInBookings)
    : { data: [] as Array<{ id: string; name: string | null; instructor: string | null }> };
  const classMetaById = new Map((classMetas ?? []).map((c) => [c.id, c]));

  const tabHref = (t: 'cal' | 'bookings') => `/classes${t === 'cal' ? '' : '?tab=bookings'}`;
  const dayHref = (iso: string) => `/classes?d=${iso}`;

  // "Today · Wed 11" for today, "Wed 11 Dec" otherwise — prototype shows the
  // "Today · …" form for the current day and a plain dated form for the rest.
  const sel = new Date(selectedIso);
  const dowAbbr = DAY_LABELS[selectedDow].slice(0, 3);
  const monAbbr = sel.toLocaleDateString('en-NG', { month: 'short' });
  const dayLabel = selectedIso === todayIso
    ? `Today · ${dowAbbr} ${sel.getDate()}`
    : `${dowAbbr} ${sel.getDate()} ${monAbbr}`;

  return (
    <div className="op-mobile member-portal member-app">
      {/* OPay-style header (matches /dashboard and /wallet) for consistent app chrome. */}
      <header className="op-header">
        <Link href="/dashboard/profile" className="op-header-avatar" aria-label="Profile">
          <span>{(user.email ?? 'M').charAt(0).toUpperCase()}</span>
        </Link>
        <div className="op-header-greet">
          Schedule
          <small>{gym.name}</small>
        </div>
        <div className="op-header-actions">
          <Link
            href="/dashboard/inbox"
            className="op-icon-btn"
            aria-label={unreadCount > 0 ? `Inbox · ${unreadCount} unread` : 'Inbox'}
          >
            <Bell strokeWidth={1.8} />
            {unreadCount > 0 && (
              <span className="op-icon-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </Link>
        </div>
      </header>

      <nav className="segtabs" aria-label="Schedule view">
        <Link href={tabHref('cal')} className={tab === 'cal' ? 'on' : ''} aria-current={tab === 'cal' ? 'page' : undefined}>Schedule</Link>
        <Link href={tabHref('bookings')} className={tab === 'bookings' ? 'on' : ''} aria-current={tab === 'bookings' ? 'page' : undefined}>My bookings</Link>
      </nav>

      {tab === 'cal' ? (
        <>
          {/* Week strip — Monday-anchored, dot when classes exist that DOW */}
          <div className="calstrip">
            {weekDays.map((d) => (
              <Link key={d.iso} href={dayHref(d.iso)} className={`cday${d.iso === selectedIso ? ' on' : ''}`}>
                <span>{d.dowShort}</span>
                <b>{d.dom}</b>
                <span className={`mk${hasOnDow.has(d.dow) ? '' : ' ghost'}`} />
              </Link>
            ))}
          </div>

          <div className="day-label">{dayLabel}</div>

          {slots.length === 0 ? (
            <EmptyState icon={CalendarX} title="No classes that day" message="Pick another day or check back later." />
          ) : (
            <div className="cls-list">
              {slots.map((s) => {
                const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                const key = bookedKey(s.id, selectedIso);
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
                      bookingDate={selectedIso}
                      memberStatus={(mine?.status as 'booked' | 'waitlisted' | undefined) ?? null}
                      bookingId={mine?.id ?? null}
                      isFull={isFull}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        // ── My bookings — upcoming first, then anything earlier this week.
        <>
          {(bookings ?? []).length === 0 ? (
            <EmptyState icon={CalendarX} title="No bookings yet" message="Tap a class on the Schedule tab to book." />
          ) : (
            <div>
              {(bookings ?? []).map((b) => {
                const sch = b.classes;
                const cls = sch?.class_id ? classMetaById.get(sch.class_id) : null;
                const d = b.booking_date ? new Date(b.booking_date) : null;
                return (
                  <div key={b.id} className="bkg">
                    <div className="date">
                      <b>{d ? d.getDate() : '—'}</b>
                      <span>{d ? SHORT[d.getDay()] : ''}</span>
                    </div>
                    <div className="m">
                      <strong>{cls?.name ?? 'Class'}</strong>
                      <small>
                        {sch?.start_time ? splitTime(sch.start_time).hm + ' ' + splitTime(sch.start_time).ap : ''}
                        {sch?.room ? ` · ${sch.room}` : ''}
                        {cls?.instructor ? ` · ${cls.instructor}` : ''}
                      </small>
                    </div>
                    <span className={`gf-badge ${b.status === 'waitlisted' ? 'gf-badge-warning' : 'gf-badge-success'}`}>
                      {b.status === 'waitlisted' ? 'Waitlist' : 'Booked'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

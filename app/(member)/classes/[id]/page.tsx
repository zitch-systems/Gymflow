import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Clock, Users, Gauge, MapPin, CalendarCheck } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watNow } from '@/lib/format';
import { BookButtonLarge } from '@/components/member/class-actions';

export const metadata = { title: 'Class details' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Stable per-class hero photo (gym.hero_image_url wins; else one of the bundled
// gym photos chosen deterministically from the class id so a class always shows
// the same image). Mirrors the prototype's photo-led class-detail hero.
const PHOTOS = [
  '/images/gym-bikes.jpg', '/images/gym-barbell.jpg', '/images/gym-studio.jpg',
  '/images/gym-kettlebells.jpg', '/images/gym-floor.jpg', '/images/gym-machines.jpg',
  '/images/gym-dumbbells.jpg', '/images/gym-action.jpg',
];
function photoFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PHOTOS[h % PHOTOS.length];
}

function fmtTime(t: string | null): string {
  const [h, m = '00'] = (t ?? '00:00').split(':');
  const hh = parseInt(h, 10);
  const ap = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${m.padStart(2, '0')} ${ap}`;
}

// The next calendar date (YYYY-MM-DD, WAT) on/after today that falls on `dow`.
function nextDateForDow(dow: number): string {
  const now = watNow();
  const delta = ((dow - now.getUTCDay()) % 7 + 7) % 7;
  const d = new Date(now.getTime() + delta * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  // Resolve the schedule (a specific time slot) scoped to the member's gym, with
  // its class. 404 for a foreign/unknown id — never leak another gym's timetable.
  const { data: sched } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time, room, class_id, is_active, classes(name, instructor, description, level, category, duration_minutes, max_capacity)')
    .eq('id', id).eq('gym_id', gym.id).maybeSingle();
  if (!sched) notFound();

  const c = (sched as unknown as {
    classes: { name: string; instructor: string | null; description: string | null; level: string | null; category: string | null; duration_minutes: number | null; max_capacity: number | null } | null;
  }).classes;

  const dow = Number(sched.day_of_week);
  const bookingDate = nextDateForDow(dow);
  const isToday = bookingDate === watNow().toISOString().slice(0, 10);

  // Already booked this occurrence? (mirrors the schedule page's bookedSet.)
  const { data: existing } = await supabase
    .from('class_bookings')
    .select('id, status')
    .eq('member_id', user.id).eq('class_schedule_id', sched.id)
    .eq('booking_date', bookingDate).neq('status', 'cancelled')
    .maybeSingle();

  const durMin = Number(c?.duration_minutes ?? 60) || 60;
  const whenLabel = `${isToday ? 'Today' : DAYS[dow]} · ${fmtTime(sched.start_time)} · ${durMin} min`;
  const coach = c?.instructor?.trim() || 'Instructor TBA';
  const hero = gym.hero_image_url || photoFor(sched.class_id ?? sched.id);

  const badges = [
    c?.level ? { icon: Gauge, text: c.level } : null,
    c?.category ? { icon: CalendarCheck, text: c.category } : null,
    { icon: Clock, text: `${durMin} min` },
    c?.max_capacity != null ? { icon: Users, text: `${c.max_capacity} spots` } : null,
    sched.room ? { icon: MapPin, text: sched.room } : null,
  ].filter(Boolean) as { icon: typeof Clock; text: string }[];

  return (
    <section className="view on" data-v="classdetail">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/classes" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to schedule"><ArrowLeft strokeWidth={2} /></Link>
        <strong className="htitle">Class details</strong>
        <span style={{ width: 34 }} />
      </div>

      <div className="cd-hero">
        <Image src={hero} alt="" width={720} height={360} priority style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div className="scrim" />
        <div className="ov">
          <h2>{c?.name ?? 'Class'}</h2>
          <small>{whenLabel}</small>
        </div>
      </div>

      {badges.length > 0 && (
        <div className="cd-meta">
          {badges.map((b, i) => {
            const Icon = b.icon;
            return <span className="gf-badge gf-badge-neutral" key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon size={13} strokeWidth={2} /> {b.text}</span>;
          })}
        </div>
      )}

      <div className="cd-coach">
        <span className="gf-avatar gf-avatar-md" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>{coach.charAt(0).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 600, fontSize: '0.92rem' }}>{coach}</div>
          <small style={{ color: 'var(--gf-text-muted)', fontSize: '0.76rem' }}>Instructor</small>
        </div>
      </div>

      <div className="cd-sec-t">About this class</div>
      <p className="cd-p">
        {c?.description?.trim() || `Join ${c?.name ?? 'this class'} at ${gym.name}. Arrive a few minutes early to settle in — the instructor will guide you through every step, whatever your level.`}
      </p>

      <div className="cd-sec-t">What to bring</div>
      <div className="cd-bring">
        <div><Check strokeWidth={2.4} /> A water bottle</div>
        <div><Check strokeWidth={2.4} /> A towel</div>
        <div><Check strokeWidth={2.4} /> Training shoes</div>
      </div>

      <div className="cd-book">
        {existing
          ? (
            <div className="gf-btn gf-btn-full gf-btn-lg" style={{ background: 'var(--gf-success-soft)', color: 'var(--gf-success)', cursor: 'default', justifyContent: 'center' }}>
              {existing.status === 'waitlisted' ? 'On the waitlist' : 'You’re booked ✓'}
            </div>
          )
          : <BookButtonLarge scheduleId={sched.id} />}
      </div>
    </section>
  );
}

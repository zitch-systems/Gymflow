import type { CSSProperties } from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  ArrowRight, CalendarDays, CalendarCheck, MessageCircle, MapPin, Phone, Navigation,
  Check, ShieldCheck, Zap, QrCode, UserRoundCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtNaira, fmt12Hr, watNow } from '@/lib/format';
import { openStateFor, todayHoursLabel } from '@/lib/opening-hours';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { ldJson } from '@/lib/ld-json';
import { accentVars } from '@/lib/accent';
import { offersTrainer, trainerAddonPrice } from '@/lib/plan-addon';
import { LogoMark } from '@/components/ui/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { InstallCards } from '@/components/gym/install-cards';
import { isOfflineGym } from '@/lib/gym-status';
import './gym-landing.css';

// ── The gym's own public page, at the root of its subdomain ──────────────────
// Built from revamp/gym-landing.html (GYM-LANDING-BUILD.md). This is a different
// surface for a different audience than GymFlow's marketing site: a prospective
// member in Lagos, on a phone, deciding whether to join THIS gym.
//
// Route note: the doc specifies `app/[slug]/(public)/page.tsx`. A dynamic segment
// at the app root would match `/login`, `/pricing`, `/about`, `/signup`… and
// shadow every marketing and auth route, so this repo resolves the subdomain
// root to `/g/<slug>` in middleware.ts instead. Same URL for the visitor
// (`powerhouse.gymflow.ng/`), no route collisions.
//
// Live occupancy has to be fresh, and it's above the fold, so the page as a
// whole is dynamic rather than ISR with a nested dynamic hole.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Gym = {
  id: string; name: string; slug: string; logo_url: string | null; tagline: string | null;
  hero_image_url: string | null; description: string | null;
  city: string | null; state: string | null; address: string | null; phone: string | null;
  email: string | null; social_links: Record<string, string> | null;
  status: string | null;
  accent_color: string | null; accent_ink: string | null;
  capacity: number | null; day_pass_price: number | null; joining_fee: number | null;
};
type Plan = { id: string; name: string; price: number | null; duration_months: number | null; duration_days: number | null; description: string | null; features: unknown; trainer_addon_enabled: boolean | null; trainer_addon_price: number | null };
type Hours = { day_of_week: number; open_time: string | null; close_time: string | null; is_closed: boolean | null };
type Zone = { id: string; name: string; blurb: string | null; photo_path: string | null };
type Coach = { id: string; full_name: string | null; photo_url: string | null; avatar_url: string | null; specialisation: string | null; bio: string | null };
type Slot = {
  id: string; start_time: string; room: string | null;
  name: string; duration: number | null; capacity: number | null; category: string | null;
  coach: string | null; booked: number | null;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** Service-role when configured (needed to count bookings and read coach
 *  profiles), else the anon client. Matches the rest of the app; sections that
 *  depend on privileged reads degrade rather than showing wrong numbers. */
async function getClient() {
  try { return { db: createAdminClient(), privileged: true }; } catch { return { db: await createClient(), privileged: false }; }
}

const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();

/** `as never` on an rpc NAME collapses the whole builder to `never`, so the two
 *  aggregate functions (which also postdate the generated types) go through this
 *  narrow wrapper instead. */
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> };

/** Monthly-equivalent price, so "from ₦X/mo" compares a 12-month plan against a
 *  monthly one honestly (§3: lowest PER MONTH, not the cheapest total). */
function perMonth(p: Plan): number | null {
  if (p.price == null) return null;
  const months = p.duration_months ?? (p.duration_days ? p.duration_days / 30 : null);
  if (!months || months <= 0) return null;
  return Number(p.price) / months;
}

function planPeriod(p: Plan): string {
  if (p.duration_months === 1) return ' /mo';
  if (p.duration_months === 12) return ' /yr';
  if (p.duration_months) return ` /${p.duration_months} mo`;
  if (p.duration_days === 1) return ' /day';
  if (p.duration_days) return ` /${p.duration_days} days`;
  return '';
}

async function loadGym(slug: string) {
  const { db, privileged } = await getClient();
  const { data: gymRow } = await db.from('gyms').select('*').eq('slug', slug).maybeSingle();
  if (!gymRow) return null;
  const gym = gymRow as unknown as Gym;
  // A gym GymFlow has switched off has no public page — 404 rather than
  // advertise memberships nobody can buy. Set from /superadmin/gyms/[id].
  if (isOfflineGym(gym)) return null;

  const now = watNow();
  const todayDow = now.getDay();

  const [plansRes, hoursRes, zonesRes, schedRes, staffRes, occRes, trafficRes] = await Promise.all([
    db.from('membership_plans').select('id, name, price, duration_months, duration_days, description, features, trainer_addon_enabled, trainer_addon_price')
      .eq('gym_id', gym.id).eq('is_active', true).order('price', { ascending: true }),
    db.from('business_hours').select('day_of_week, open_time, close_time, is_closed')
      .eq('gym_id', gym.id).order('day_of_week', { ascending: true }).order('open_time', { ascending: true }),
    // `as never` on gym_zones and the two rpcs: all three postdate the generated
    // lib/database.types.ts, the same pattern webhook_events uses in the Paystack
    // route. Results are cast to the local row types below.
    db.from('gym_zones' as never).select('id, name, blurb, photo_path').eq('gym_id', gym.id)
      .order('sort_order', { ascending: true }).limit(8),
    // Today's timetable, in the order it runs.
    db.from('class_schedules')
      .select('id, start_time, room, class_id, instructor_id, classes(name, duration_minutes, max_capacity, category, instructor)')
      .eq('gym_id', gym.id).eq('is_active', true).eq('day_of_week', todayDow)
      .order('start_time', { ascending: true }),
    db.from('gym_staff_links').select('user_id').eq('gym_id', gym.id).eq('role', 'instructor').eq('is_active', true).limit(6),
    (db as unknown as RpcClient).rpc('gym_live_occupancy', { p_gym: gym.id }),
    (db as unknown as RpcClient).rpc('gym_hourly_traffic', { p_gym: gym.id, p_days: 30 }),
  ]);

  // Coach profiles are only readable with the service role (profiles is gated by
  // can_see_profile), so this section is absent rather than empty on the anon path.
  const coachIds = ((staffRes.data as { user_id: string }[] | null) ?? []).map((s) => s.user_id);
  const coaches = coachIds.length
    ? (((await db.from('profiles').select('id, full_name, photo_url, avatar_url, specialisation, bio').in('user_id', coachIds)).data as Coach[] | null) ?? [])
    : [];

  // Spot counts need to see other members' bookings — privileged only. Without
  // it we render the class with no count rather than an inflated one.
  const rawSlots = (schedRes.data ?? []) as unknown as {
    id: string; start_time: string; room: string | null; instructor_id: string | null;
    classes: { name: string; duration_minutes: number | null; max_capacity: number | null; category: string | null; instructor: string | null } | null;
  }[];
  let bookedBySchedule = new Map<string, number>();
  if (privileged && rawSlots.length) {
    const todayIso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const { data: bk } = await db.from('class_bookings')
      .select('class_schedule_id')
      .eq('gym_id', gym.id).eq('booking_date', todayIso).eq('status', 'booked')
      .in('class_schedule_id', rawSlots.map((s) => s.id));
    bookedBySchedule = ((bk ?? []) as { class_schedule_id: string | null }[]).reduce((m, r) => {
      if (r.class_schedule_id) m.set(r.class_schedule_id, (m.get(r.class_schedule_id) ?? 0) + 1);
      return m;
    }, new Map<string, number>());
  }

  const slots: Slot[] = rawSlots
    .filter((s) => s.classes)
    .map((s) => ({
      id: s.id,
      start_time: s.start_time,
      room: s.room,
      name: s.classes!.name,
      duration: s.classes!.duration_minutes,
      capacity: s.classes!.max_capacity,
      category: s.classes!.category,
      coach: s.classes!.instructor,
      booked: privileged ? (bookedBySchedule.get(s.id) ?? 0) : null,
    }));

  return {
    gym,
    plans: (plansRes.data as Plan[] | null) ?? [],
    hours: (hoursRes.data as Hours[] | null) ?? [],
    zones: (zonesRes.data as unknown as Zone[] | null) ?? [],
    coaches: coaches.filter((c) => (c.full_name ?? '').trim()),
    slots,
    inNow: typeof occRes.data === 'number' ? (occRes.data as number) : null,
    traffic: (trafficRes.data as unknown as { hour_of_day: number; visits: number }[] | null) ?? [],
    now,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadGym(slug);
  if (!page) return { title: 'Gym not found', robots: { index: false } };
  const { gym } = page;
  const where = [gym.city, gym.state].filter(Boolean).join(', ');
  const canonical = `https://${slug}.${ROOT_DOMAIN}/`;
  const description = gym.description || gym.tagline
    || `Membership, classes and opening hours at ${gym.name}${where ? ` in ${where}` : ''}. Join online and train today.`;
  const og = gym.hero_image_url || gym.logo_url || '/images/og.png';
  return {
    title: where ? `${gym.name} — ${where}` : gym.name,
    description,
    alternates: { canonical },
    openGraph: { title: gym.name, description, type: 'website', url: canonical, images: [{ url: og, alt: gym.name }] },
    twitter: { card: 'summary_large_image', title: gym.name, description, images: [og] },
  };
}

export default async function GymPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadGym(slug);
  if (!page) notFound();
  const { gym, plans, hours, zones, coaches, slots, inNow, traffic, now } = page;

  // ── Tenant theme. Set inline on the server-rendered wrapper so there's never
  // a flash of GymFlow's colour on a gym's page. ──
  const style = accentVars(gym.accent_color, gym.accent_ink) as unknown as CSSProperties;

  const area = [gym.city, gym.state].filter(Boolean).join(' · ');
  const status = openStateFor(hours, now);
  const todayHours = todayHoursLabel(hours, now);
  const joinHref = `/join/${gym.slug}` as Route;
  // Where "Join" sends someone. Scrolling to #plans is the better journey — they
  // pick a plan and it rides along into checkout — but that section only exists
  // when the gym has published plans. Gyms that haven't (2 of 5 live ones) were
  // left with Join buttons that scrolled to an anchor that isn't in the
  // document, so nothing happened at all. Fall back to the join form, which
  // needs no plan: it creates the account and the gym takes payment later.
  const joinCta: string = plans.length > 0 ? '#plans' : joinHref;

  const whatsapp = (gym.social_links ?? {}).whatsapp?.replace(/\D/g, '') || null;
  const waHref = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi ${gym.name}, I'd like to know more about joining.`)}`
    : null;
  const directionsHref = (gym.address || gym.city)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([gym.name, gym.address, gym.city, gym.state].filter(Boolean).join(', '))}`
    : null;

  // Hero facts + the sticky bar's price all come off the true cheapest per-month.
  const monthly = plans.map(perMonth).filter((v): v is number => v != null && v > 0);
  const fromPrice = monthly.length ? Math.min(...monthly) : null;
  // No is_popular column, so the flag is DERIVED from price rather than invented:
  // the plan with the lowest cost per month, and only when there's a choice.
  const bestId = (() => {
    const priced = plans.map((p) => ({ id: p.id, m: perMonth(p) })).filter((x): x is { id: string; m: number } => x.m != null && x.m > 0);
    if (priced.length < 2) return null;
    return priced.reduce((a, b) => (b.m < a.m ? b : a)).id;
  })();

  // ── Live occupancy (§4). Hidden entirely for a gym with no capacity set or no
  // check-in history — "0 of 120" is a worse signal than no signal. ──
  const showOcc = gym.capacity != null && gym.capacity > 0 && inNow != null && traffic.length > 0;
  const pct = showOcc ? Math.min(100, Math.round((inNow! / gym.capacity!) * 100)) : 0;
  const occState = pct < 40 ? { label: 'Quiet · plenty of space', cls: '' }
    : pct < 75 ? { label: 'Busy', cls: 'busy' }
      : { label: 'Very busy · expect a wait', cls: 'packed' };
  // Busiest/quietest from the 30-day aggregate, never from today.
  const band = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 2) % 24).padStart(2, '0')}:00`;
  const busiest = traffic.length ? traffic.reduce((a, b) => (Number(b.visits) > Number(a.visits) ? b : a)) : null;
  const quietest = traffic.length ? traffic.reduce((a, b) => (Number(b.visits) < Number(a.visits) ? b : a)) : null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const nextSlot = slots.find((s) => mins(s.start_time) >= nowMin) ?? null;
  const spotsFor = (s: Slot) => (s.capacity == null || s.booked == null ? null : Math.max(0, s.capacity - s.booked));

  const zoneUrl = (p: string | null) =>
    p ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/gym-assets/${p}` : null;

  const canonical = `https://${gym.slug}.${ROOT_DOMAIN}/`;
  const openDays = hours.filter((h) => !h.is_closed && h.open_time);
  // ExerciseGym + real opening hours. No aggregateRating: this gym has no review
  // data, and inventing one is exactly what §6 forbids.
  const gymLd = ldJson({
    '@context': 'https://schema.org',
    '@type': 'ExerciseGym',
    name: gym.name,
    url: canonical,
    image: gym.hero_image_url || gym.logo_url || undefined,
    description: gym.description || gym.tagline || undefined,
    telephone: gym.phone || undefined,
    email: gym.email || undefined,
    address: (gym.address || gym.city)
      ? { '@type': 'PostalAddress', streetAddress: gym.address || undefined, addressLocality: gym.city || undefined, addressRegion: gym.state || undefined, addressCountry: 'NG' }
      : undefined,
    priceRange: monthly.length ? `${fmtNaira(Math.round(Math.min(...monthly)))}–${fmtNaira(Math.round(Math.max(...monthly)))}` : undefined,
    openingHoursSpecification: openDays.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAYS[h.day_of_week],
      opens: String(h.open_time).slice(0, 5),
      closes: String(h.close_time ?? '').slice(0, 5),
    })),
  });

  const NAV = [
    plans.length > 0 ? ['#plans', 'Membership'] : null,
    slots.length > 0 ? ['#classes', 'Classes'] : null,
    zones.length > 0 ? ['#gym', 'The gym'] : null,
    ['#app', 'App'],
    ['#visit', 'Visit'],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="gym-public" style={style}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: gymLd }} />

      {/* ── NAV ── */}
      <nav className="nav">
        <div className="wrap nav-in">
          <a className="gym" href="#top">
            <span className={gym.logo_url ? 'sq has-logo' : 'sq'}>
              {gym.logo_url ? <Image src={gym.logo_url} alt="" width={42} height={42} /> : initial(gym.name)}
            </span>
            <span className="nm">
              <strong>{gym.name}</strong>
              {area && <small>{area}</small>}
            </span>
          </a>
          <div className="nav-r">
            <div className="nav-links">
              {NAV.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
            </div>
            {status && (
              <span className={`open${status.open ? '' : ' shut'}`}>
                <span className="dot" />{status.label}{status.detail ? ` · ${status.detail}` : ''}
              </span>
            )}
            <ThemeToggle size={38} />
            {waHref && (
              <a href={waHref} className="b b-out b-sm" target="_blank" rel="noreferrer">
                <MessageCircle strokeWidth={1.75} /> WhatsApp
              </a>
            )}
            {/* Two doors, one each way: someone who already trains here signs
                in, someone who doesn't joins. On a gym subdomain — which is
                where this page always is in production, since the apex path
                308s here — /login renders THIS gym's branded member sign-in,
                so the bare path is right. Deliberately not .b-out: that class
                is display:none below 560px, and sign-in has to survive on a
                phone. */}
            <Link href="/login" className="nav-signin">Sign in</Link>
            <a href={joinCta} className="b b-acc b-sm">Join now</a>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <header className="hero" id="top">
        <div className="hero-bg" aria-hidden>
          <Image src={gym.hero_image_url || '/images/gym-hero.jpg'} alt="" fill priority sizes="100vw" />
        </div>
        <div className="wrap hero-in">
          <div className="hero-copy">
          <h1>{gym.tagline || <>Train at <em>{gym.name}</em>.</>}</h1>
          {gym.description && <p className="pitch">{gym.description}</p>}
          <div className="hero-cta">
            <a href={joinCta} className="b b-acc"><ArrowRight strokeWidth={1.75} /> Join {gym.name}</a>
            {slots.length > 0 && <a href="#classes" className="b b-out"><CalendarDays strokeWidth={1.75} /> See today&apos;s classes</a>}
          </div>
          <dl className="hero-facts">
            {fromPrice != null && (
              <div className="fact"><dt>Membership from</dt><dd><span>{fmtNaira(Math.round(fromPrice))}</span><small> /mo</small></dd></div>
            )}
            {gym.day_pass_price != null && (
              <div className="fact"><dt>Day pass</dt><dd>{fmtNaira(Number(gym.day_pass_price))}</dd></div>
            )}
            {todayHours && <div className="fact"><dt>Today</dt><dd>{todayHours}</dd></div>}
            {gym.joining_fee != null && (
              <div className="fact"><dt>Joining fee</dt><dd>{Number(gym.joining_fee) === 0 ? 'None' : fmtNaira(Number(gym.joining_fee))}</dd></div>
            )}
          </dl>
          <ul className="hero-trust">
            <li><Zap strokeWidth={1.8} /> Instant activation</li>
            <li><ShieldCheck strokeWidth={1.8} /> Secure Paystack checkout</li>
            <li><Check strokeWidth={2.2} /> Cancel from your phone</li>
          </ul>
          </div>
          {/* Sign-up QR — the same code the gym prints from its console. Desktop
              only, and drawn as a background-image inside a media query so
              phones never download it. Sits on its own white tile because the
              code has to stay black-on-white over the hero photo. */}
          <div className="hero-qr" style={{ ['--qr' as string]: `url(/g/${gym.slug}/join-qr)` }}>
            <i aria-hidden="true" />
            <span><QrCode strokeWidth={1.75} /> Scan to join on your phone</span>
          </div>
        </div>
      </header>

      {/* ── LIVE STRIP — the one thing a Wix site can't render ── */}
      {(showOcc || nextSlot || slots.length > 0) && (
        <div className="live">
          <div className="wrap live-in">
            {showOcc && (
              <div>
                <div className="lab"><span className="pulse" />How busy it is right now</div>
                <div className="occ">
                  <div className="top">
                    <span className="n">{inNow}</span>
                    <span className={`st ${occState.cls}`}>{occState.label}</span>
                  </div>
                  <div className="bar"><i style={{ width: `${Math.max(pct, 2)}%` }} /></div>
                  <div className="hint">
                    {inNow} of {gym.capacity} checked in
                    {busiest && ` · busiest ${band(busiest.hour_of_day)}`}
                    {quietest && busiest && quietest.hour_of_day !== busiest.hour_of_day && ` · quietest ${band(quietest.hour_of_day)}`}
                  </div>
                </div>
              </div>
            )}
            {nextSlot && (
              <div>
                <div className="lab"><Zap strokeWidth={1.75} style={{ width: 13, height: 13 }} /> Next class</div>
                <div className="nx">
                  <strong>{fmt12Hr(nextSlot.start_time.slice(0, 5))} · {nextSlot.name}</strong>
                  <small>
                    {[nextSlot.coach, spotsFor(nextSlot) === 0 ? 'waitlist only' : spotsFor(nextSlot) != null ? `${spotsFor(nextSlot)} spots left` : null]
                      .filter(Boolean).join(' · ')}
                  </small>
                </div>
              </div>
            )}
            {slots.length > 0 && (
              <div>
                <div className="lab"><CalendarCheck strokeWidth={1.75} style={{ width: 13, height: 13 }} /> Classes today</div>
                <div className="nx">
                  <strong>{slots.length} session{slots.length === 1 ? '' : 's'}</strong>
                  <small>{[...new Set(slots.map((s) => s.name))].slice(0, 4).join(' · ')}</small>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PLANS ── */}
      {plans.length > 0 && (
        <section className="sec" id="plans">
          <div className="wrap">
            <div className="sh">
              <div>
                <span className="eb">Membership</span>
                <h2>Pick a plan. Train today.</h2>
                <p>Pay with card or transfer and your access is live in minutes — no queue at the front desk.</p>
              </div>
              <span className="open"><span className="dot" />Instant activation</span>
            </div>
            <div className="plans">
              {plans.map((p) => {
                const feats = Array.isArray(p.features) ? (p.features as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 5) : [];
                const pm = perMonth(p);
                const best = p.id === bestId;
                return (
                  <div className={`plan${best ? ' pop' : ''}`} key={p.id}>
                    {best && <span className="tag">Best value</span>}
                    <div className="pn">{p.name}</div>
                    <div className="amt">{p.price != null ? fmtNaira(Number(p.price)) : '—'}<small>{planPeriod(p)}</small></div>
                    {pm != null && (p.duration_months ?? 0) > 1
                      ? <div className="save">{fmtNaira(Math.round(pm))}/mo</div>
                      : <div className="save plain">Rolling · cancel anytime</div>}
                    {p.description && <p className="secp" style={{ margin: '10px 0 0', fontSize: '.88rem' }}>{p.description}</p>}
                    {feats.length > 0 && (
                      <ul>{feats.map((f, i) => <li key={i}><Check strokeWidth={1.75} /> {f}</li>)}</ul>
                    )}
                    {offersTrainer(p) && (
                      // Advertised here because it's a reason to pick this plan
                      // over the one next to it — but priced as an extra, so
                      // the headline figure above stays the truth about what
                      // joining costs.
                      <div className="plan-extra">
                        <UserRoundCheck strokeWidth={1.75} />
                        {trainerAddonPrice(p) > 0
                          ? <span>Private trainer available <b>+{fmtNaira(trainerAddonPrice(p))}</b> — optional</span>
                          : <span>Private trainer included — optional</span>}
                      </div>
                    )}
                    {/* Carries the choice into the join + Paystack flow. */}
                    <Link href={`${joinHref}?plan=${p.id}` as Route} className={`b ${best ? 'b-acc' : 'b-out'}`} style={{ marginTop: 'auto' }}>
                      Choose {p.name}
                    </Link>
                  </div>
                );
              })}
            </div>
            <div className="paynote">
              <ShieldCheck strokeWidth={1.75} /> Secured by Paystack — card or bank transfer, in Naira.
              {gym.joining_fee != null && Number(gym.joining_fee) === 0 && <><span style={{ color: 'var(--gf-border-light)' }}>·</span> No joining fee</>}
              <span style={{ color: 'var(--gf-border-light)' }}>·</span> Cancel anytime from your phone
            </div>
          </div>
        </section>
      )}

      {/* ── TODAY'S CLASSES ── */}
      {slots.length > 0 && (
        <section className="sec alt" id="classes">
          <div className="wrap">
            <div className="sh">
              <div>
                <span className="eb">Today · {DAYS[now.getDay()]}</span>
                <h2>Book a class in two taps.</h2>
                <p>Straight from the timetable your coaches manage.</p>
              </div>
              <Link href="/classes" className="b b-out b-sm"><CalendarDays strokeWidth={1.75} /> See full week</Link>
            </div>
            <div className="tt">
              {slots.map((s) => {
                const left = spotsFor(s);
                const full = left === 0;
                const cls = left == null ? '' : full ? 'full' : left <= 5 ? 'low' : 'ok';
                return (
                  <div className="tt-row" key={s.id}>
                    <span className="t">{fmt12Hr(s.start_time.slice(0, 5))}</span>
                    <span className="cn">
                      {s.name}
                      <small>{[s.duration ? `${s.duration} min` : null, s.room || s.category].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span className="co">
                      {s.coach ? <><span className="av">{initial(s.coach)}</span>{s.coach}</> : null}
                    </span>
                    {left != null && <span className={`spots ${cls}`}>{full ? 'Full' : `${left} spots left`}</span>}
                    {/* Anonymous visitors sign up first, with the class preserved
                        so they land back on it. Capacity is enforced server-side
                        in bookClass — never trusted from this render. */}
                    <Link href={`${joinHref}?class=${s.id}` as Route} className={`b b-sm ${full ? 'b-out' : 'b-acc'}`}>
                      {full ? 'Join waitlist' : 'Book'}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── THE GYM — the gym's own zones, never stock photography ── */}
      {zones.length > 0 && (
        <section className="sec" id="gym">
          <div className="wrap">
            <div className="sh">
              <div>
                <span className="eb">The floor</span>
                <h2>{zones.length} zone{zones.length === 1 ? '' : 's'}.</h2>
                <p>Every photo here is our actual floor — not a stock photo of someone else&apos;s gym.</p>
              </div>
            </div>
            <div className="zones">
              {zones.map((z) => {
                const url = zoneUrl(z.photo_path);
                return (
                  <div className="zone" key={z.id}>
                    {url && <Image src={url} alt={z.name} width={600} height={800} sizes="(max-width: 860px) 45vw, 280px" loading="lazy" />}
                    <span className="cap">
                      <strong>{z.name}</strong>
                      {z.blurb && <small>{z.blurb}</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── COACHES ── */}
      {coaches.length > 0 && (
        <section className="sec alt">
          <div className="wrap">
            <div className="sh">
              <div>
                <span className="eb">The team</span>
                <h2>Coaches who know your name.</h2>
              </div>
            </div>
            <div className="coaches">
              {coaches.map((c) => {
                const photo = c.photo_url || c.avatar_url;
                return (
                  <div className="coach" key={c.id}>
                    <span className="av">
                      {photo ? <Image src={photo} alt="" width={60} height={60} /> : initial(c.full_name ?? '')}
                    </span>
                    <div>
                      <strong>{c.full_name}</strong>
                      {c.specialisation && <small>{c.specialisation}</small>}
                      {c.bio && <p>{c.bio}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── MEMBER APP (install instructions, not store badges — §5) ── */}
      <section className="sec alt" id="app">
        <div className="wrap app-in">
          <div className="app-vis">
            <span className={gym.logo_url ? 'app-ic has-logo' : 'app-ic'}>
              {gym.logo_url ? <Image src={gym.logo_url} alt="" width={132} height={132} /> : initial(gym.name)}
            </span>
            <span className="nmx">
              <strong>{gym.name}</strong>
              <small>Your membership, on your home screen</small>
            </span>
          </div>
          <div>
            <span className="eb">Member app</span>
            <h2 className="sech2">Install it on iPhone or Android.</h2>
            <p className="secp">Works on both, straight from your browser — nothing to download from a store, and it updates itself.</p>
            <InstallCards gymName={gym.name} />
          </div>
        </div>
      </section>


      {/* ── VISIT ── */}
      {(gym.address || gym.phone || openDays.length > 0) && (
        <section className="sec alt" id="visit">
          <div className="wrap">
            <div className="sh">
              <div>
                <span className="eb">Visit</span>
                <h2>Come and look around.</h2>
                <p>Walk in for a tour any time we&apos;re open — no appointment, no sales pitch.</p>
              </div>
            </div>
            <div className="visit">
              <div>
                {(gym.address || gym.city) && (
                  <div className="addr">
                    <span className="ic"><MapPin strokeWidth={1.75} /></span>
                    <div>
                      <strong>{gym.address || gym.city}</strong>
                      {(gym.address && area) && <small>{area}</small>}
                    </div>
                  </div>
                )}
                {gym.phone && (
                  <div className="addr">
                    <span className="ic"><Phone strokeWidth={1.75} /></span>
                    <div>
                      <strong><a href={`tel:${gym.phone}`}>{gym.phone}</a></strong>
                      {todayHours && <small>Front desk · {todayHours} today</small>}
                    </div>
                  </div>
                )}
                {openDays.length > 0 && (() => {
                  const byDay = new Map<number, Hours[]>();
                  for (const h of hours) byDay.set(h.day_of_week, [...(byDay.get(h.day_of_week) ?? []), h]);
                  return (
                    <div className="hours">
                      {WEEK.map((d) => {
                        const rows = (byDay.get(d) ?? []).filter((r) => !r.is_closed && r.open_time);
                        return (
                          <div className={d === now.getDay() ? 'now' : undefined} key={d}>
                            <span>{DAYS[d]}{d === now.getDay() ? ' · today' : ''}</span>
                            <span>
                              {rows.length === 0 ? 'Closed'
                                : rows.map((r) => `${fmt12Hr(String(r.open_time).slice(0, 5))} – ${fmt12Hr(String(r.close_time ?? '').slice(0, 5))}`).join(' · ')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
                  {waHref && <a href={waHref} className="b b-wa" target="_blank" rel="noreferrer"><MessageCircle strokeWidth={1.75} /> Chat on WhatsApp</a>}
                  {directionsHref && <a href={directionsHref} className="b b-out" target="_blank" rel="noreferrer"><Navigation strokeWidth={1.75} /> Get directions</a>}
                </div>
              </div>
              {directionsHref && (
                <a className="map" href={directionsHref} target="_blank" rel="noreferrer" aria-label={`Directions to ${gym.name}`}>
                  <Image src={gym.hero_image_url || '/images/gym-hero.jpg'} alt="" width={800} height={600} sizes="(max-width: 860px) 100vw, 480px" loading="lazy" />
                  <span className="pin"><MapPin strokeWidth={1.75} /></span>
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── CTA ── */}
      <section className="cta">
        <div className="wrap cta-in">
          <h2>Your first session can be today.</h2>
          <p>Join online in under two minutes, or walk in and we&apos;ll set you up at the desk.</p>
          <div className="row">
            <Link href={joinHref} className="b b-dark"><ArrowRight strokeWidth={1.75} /> Join {gym.name}</Link>
            {waHref && <a href={waHref} className="b b-line" target="_blank" rel="noreferrer"><MessageCircle strokeWidth={1.75} /> Ask us a question</a>}
          </div>
        </div>
      </section>

      {/* ── FOOTER — the only place GymFlow appears on a tenant page ── */}
      <footer>
        <div className="wrap">
          <div className="f-top">
            <div className="gym">
              <span className={gym.logo_url ? 'sq has-logo' : 'sq'}>
                {gym.logo_url ? <Image src={gym.logo_url} alt="" width={42} height={42} /> : initial(gym.name)}
              </span>
              <span className="nm">
                <strong>{gym.name}</strong>
                {(gym.address || area) && <small>{[gym.address, area].filter(Boolean).join(', ')}</small>}
              </span>
            </div>
            <div className="f-links">
              {NAV.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
              <Link href="/login">Member sign-in</Link>
              <Link href={joinHref}>Create an account</Link>
            </div>
          </div>
          <div className="f-base">
            <span>© {now.getFullYear()} {gym.name} · {gym.slug}.{ROOT_DOMAIN}</span>
            <a className="pw" href="https://gymflow.ng" target="_blank" rel="noreferrer">
              <LogoMark size={19} /> Powered by <b>GymFlow</b>
            </a>
          </div>
        </div>
      </footer>

      {/* ── STICKY JOIN BAR (≤760px) ── */}
      {fromPrice != null && (
        <div className="joinbar">
          <span className="pr">
            <strong>From {fmtNaira(Math.round(fromPrice))}/mo</strong>
            <small>{gym.joining_fee != null && Number(gym.joining_fee) === 0 ? 'No joining fee · ' : ''}cancel anytime</small>
          </span>
          <a href={joinCta} className="b b-acc b-sm">Join now</a>
        </div>
      )}
    </div>
  );
}

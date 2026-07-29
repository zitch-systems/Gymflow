import type { CSSProperties } from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  ArrowRight, LogIn, UserPlus, Dumbbell, MapPin, Phone, Mail, Globe,
  Clock, Check, CalendarDays, QrCode, CalendarCheck, Wallet, Navigation,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtNaira, fmt12Hr, watNow } from '@/lib/format';
import { openStateFor, todayHoursLabel, openDaysPerWeek } from '@/lib/opening-hours';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { ldJson } from '@/lib/ld-json';
import { Tilt, Reveal } from '@/components/marketing/landing-fx';
import { GymNav, type GymNavSection } from '@/components/marketing/gym-nav';
import { InstagramEmbeds } from '@/components/marketing/instagram-embeds';
import { LandingTrackers } from '@/components/marketing/landing-trackers';
import { AppInstall } from '@/components/marketing/app-install';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Gym = {
  id: string; name: string; slug: string; logo_url: string | null; tagline: string | null;
  hero_image_url: string | null; brand_color: string | null; description: string | null;
  city: string | null; state: string | null; address: string | null; phone: string | null; email: string | null; website: string | null;
  amenities: string[] | null;
  social_links: Record<string, string> | null; gallery_urls: string[] | null;
  instagram_posts: string[] | null;
  integrations: Record<string, string> | null;
};
type Plan = { id: string; name: string; price: number | null; currency: string | null; duration_months: number | null; duration_days: number | null; description: string | null; features: unknown };
type Klass = {
  id: string; name: string; category: string | null; duration_minutes: number | null; level: string | null; description: string | null;
  day_of_week: number | null; start_time: string | null;
};
type Hours = { day_of_week: number; open_time: string | null; close_time: string | null; is_closed: boolean | null; session: string | null };

type GymPage = { gym: Gym; plans: Plan[]; classes: Klass[]; hours: Hours[] };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Week starts Monday for a timetable a Nigerian gym-goer reads.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// Social platforms shown on the landing page. `href` turns the stored value
// (a handle or a full URL) into a link; `path` is a brand glyph (simple-icons,
// 24×24) rendered inline so it doesn't depend on lucide having the brand icon.
const clean = (v: string) => v.trim().replace(/^@+/, '');
const SOCIALS: { key: string; label: string; path: string; href: (v: string) => string }[] = [
  { key: 'instagram', label: 'Instagram', href: (v) => v.startsWith('http') ? v : `https://instagram.com/${clean(v)}`,
    path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z' },
  { key: 'facebook', label: 'Facebook', href: (v) => v.startsWith('http') ? v : `https://facebook.com/${clean(v)}`,
    path: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
  { key: 'x', label: 'X', href: (v) => v.startsWith('http') ? v : `https://x.com/${clean(v)}`,
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  { key: 'tiktok', label: 'TikTok', href: (v) => v.startsWith('http') ? v : `https://tiktok.com/@${clean(v)}`,
    path: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
  { key: 'youtube', label: 'YouTube', href: (v) => v.startsWith('http') ? v : `https://youtube.com/${clean(v)}`,
    path: 'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
  { key: 'whatsapp', label: 'WhatsApp', href: (v) => v.startsWith('http') ? v : `https://wa.me/${v.replace(/\D/g, '')}`,
    path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z' },
];

// One client for the whole page: the service-role client when available (so the
// public page works regardless of how gym-asset RLS is set), else the anon
// client. gyms/plans/classes are intended to be publicly visible.
async function getClient() {
  try { return createAdminClient(); } catch { return await createClient(); }
}

async function loadGymPage(slug: string): Promise<GymPage | null> {
  const db = await getClient();
  // select('*') — generated types are stale for brand_color; the row is small.
  const { data: gymRow } = await db.from('gyms').select('*').eq('slug', slug).maybeSingle();
  if (!gymRow) return null;
  const gym = gymRow as unknown as Gym;

  const [plansRes, classesRes, hoursRes] = await Promise.all([
    db.from('membership_plans').select('id, name, price, currency, duration_months, duration_days, description, features').eq('gym_id', gym.id).eq('is_active', true).order('price', { ascending: true }),
    // day_of_week/start_time turn the class list into a real timetable — "what
    // runs here" is a weaker answer than "what runs here on Tuesday at 6".
    db.from('classes').select('id, name, category, duration_minutes, level, description, day_of_week, start_time').eq('gym_id', gym.id).eq('is_active', true).order('name', { ascending: true }).limit(24),
    db.from('business_hours').select('day_of_week, open_time, close_time, is_closed, session').eq('gym_id', gym.id).order('day_of_week', { ascending: true }).order('open_time', { ascending: true }),
  ]);

  return {
    gym,
    plans: (plansRes.data as Plan[] | null) ?? [],
    classes: (classesRes.data as Klass[] | null) ?? [],
    hours: (hoursRes.data as Hours[] | null) ?? [],
  };
}

// Same source as the middleware's 308 redirect and the sitemap's per-tenant
// entries (lib/tenant.ts). Deriving a separate host from NEXT_PUBLIC_SITE_URL
// here made the canonical disagree with both whenever NEXT_PUBLIC_ROOT_DOMAIN
// was set to a different host — search engines would see the canonical,
// sitemap URL and redirect target point at different subdomain hosts.
const ROOT_HOST = ROOT_DOMAIN;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadGymPage(slug);
  if (!page) return { title: 'Gym not found', robots: { index: false } };
  const { gym } = page;
  const title = `${gym.name} — Members`;
  const description = gym.tagline || gym.description || `Sign in or join ${gym.name}. Check in, book classes and manage your membership.`;
  // Point canonical at the subdomain URL — the same page is reachable at both
  // <slug>.<root>/ and <root>/g/<slug>, which would otherwise create duplicate content.
  const canonical = `https://${slug}.${ROOT_HOST}/`;
  const ogImg = gym.hero_image_url || gym.logo_url || '/images/og.png';
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: gym.name, description, type: 'website', url: canonical, images: [{ url: ogImg, alt: gym.name }] },
    twitter: { card: 'summary_large_image', title: gym.name, description, images: [ogImg] },
  };
}

function planPeriod(p: Plan): string {
  if (p.duration_months) return `/ ${p.duration_months === 1 ? 'month' : `${p.duration_months} months`}`;
  if (p.duration_days) return `/ ${p.duration_days === 1 ? 'day' : `${p.duration_days} days`}`;
  return '';
}

/** Monthly-equivalent cost, for comparing a 12-month plan against a monthly one.
 *  Null when the plan has no price or no duration to divide by. */
function monthlyEquivalent(p: Plan): number | null {
  if (p.price == null) return null;
  const months = p.duration_months ?? (p.duration_days ? p.duration_days / 30 : null);
  if (!months || months <= 0) return null;
  return Number(p.price) / months;
}

export default async function GymLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadGymPage(slug);
  if (!page) notFound();
  const { gym, plans, classes, hours } = page;
  const amenities = (gym.amenities ?? []).filter((a) => typeof a === 'string' && a.trim());
  const socials = SOCIALS
    .map((s) => ({ ...s, value: (gym.social_links ?? {})[s.key] }))
    .filter((s): s is typeof s & { value: string } => typeof s.value === 'string' && s.value.trim().length > 0);
  const gallery = (gym.gallery_urls ?? []).filter((u) => typeof u === 'string' && u.trim());
  const igPosts = (gym.instagram_posts ?? []).filter((u) => typeof u === 'string' && u.trim()).slice(0, 6);
  const igHandle = (gym.social_links ?? {}).instagram;
  const integ = gym.integrations ?? {};

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Default to GymFlow green when the gym hasn't picked a brand colour.
  const brand = gym.brand_color || '#11d18b';
  const style: CSSProperties = {
    '--gf-brand': brand,
    '--gf-brand-light': `color-mix(in srgb, ${brand} 72%, white)`,
    '--gf-brand-dark': `color-mix(in srgb, ${brand} 78%, black)`,
    '--gf-brand-soft': `color-mix(in srgb, ${brand} 14%, transparent)`,
    '--gf-brand-glow': `color-mix(in srgb, ${brand} 32%, transparent)`,
  } as CSSProperties;

  const openDays = hours.filter((h) => !h.is_closed && h.open_time);

  // Live status. Gyms and their members are in WAT, so the clock has to be too
  // — a UTC "now" would call a 9pm-closing gym shut an hour early.
  const now = watNow();
  const status = openStateFor(hours, now);
  const todayHours = todayHoursLabel(hours, now);
  const daysPerWeek = openDaysPerWeek(hours);

  // Cheapest monthly-equivalent price, for the hero's price anchor. "From
  // ₦12,000/month" answers the first question a visitor actually has; a count
  // of how many plans exist answers nobody's.
  const monthlyPrices = plans.map(monthlyEquivalent).filter((v): v is number => v != null && v > 0);
  const fromPrice = monthlyPrices.length ? Math.min(...monthlyPrices) : null;
  // Best value = lowest cost per month among plans that state a duration. Named
  // from the data rather than a "Most popular" badge we'd have to invent.
  const bestValueId = (() => {
    const priced = plans.map((p) => ({ id: p.id, m: monthlyEquivalent(p) })).filter((x): x is { id: string; m: number } => x.m != null && x.m > 0);
    if (priced.length < 2) return null;
    return priced.reduce((a, b) => (b.m < a.m ? b : a)).id;
  })();

  const scheduled = classes.filter((c) => c.day_of_week != null && c.start_time);
  const directionsHref = (gym.address || gym.city)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([gym.name, gym.address, gym.city, gym.state].filter(Boolean).join(', '))}`
    : null;

  // typedRoutes: a dynamic path assembled into a const loses its route type,
  // so it is asserted once here (house pattern — see components/pagination.tsx).
  const joinHref = `/join/${gym.slug}` as Route;

  // Jump links for the sticky bar — only sections that actually rendered.
  const navSections: GymNavSection[] = [
    plans.length > 0 ? { id: 'plans', label: 'Plans' } : null,
    classes.length > 0 ? { id: 'classes', label: 'Classes' } : null,
    gallery.length > 0 ? { id: 'gallery', label: 'Gallery' } : null,
    openDays.length > 0 ? { id: 'hours', label: 'Hours' } : null,
    (gym.address || gym.phone || gym.email) ? { id: 'visit', label: 'Visit' } : null,
  ].filter(Boolean) as GymNavSection[];

  // Local-business structured data — the gym landing is the strongest rich-result
  // target (real local business with address, hours, contact).
  const canonical = `https://${gym.slug}.${ROOT_HOST}/`;
  const gymLd = ldJson({
    '@context': 'https://schema.org',
    '@type': 'HealthClub',
    name: gym.name,
    url: canonical,
    image: gym.hero_image_url || gym.logo_url || undefined,
    description: gym.description || gym.tagline || undefined,
    telephone: gym.phone || undefined,
    email: gym.email || undefined,
    address: (gym.address || gym.city)
      ? { '@type': 'PostalAddress', streetAddress: gym.address || undefined, addressLocality: gym.city || undefined, addressCountry: 'NG' }
      : undefined,
    // Price range from the real plans — Google shows it in local results, and
    // it costs nothing now that the cheapest plan is already computed.
    priceRange: fromPrice ? `${fmtNaira(Math.min(...monthlyPrices))}–${fmtNaira(Math.max(...monthlyPrices))}` : undefined,
    openingHoursSpecification: openDays.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAYS[h.day_of_week],
      opens: String(h.open_time).slice(0, 5),
      closes: String(h.close_time ?? '').slice(0, 5),
    })),
  });
  // gym.name / description are gym-owner-controlled and go into the document
  // through dangerouslySetInnerHTML — ldJson() is what stops a literal
  // </script> in either from breaking out of the tag (lib/ld-json.ts).

  return (
    <main id="main-content" className="gymland" style={style}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: gymLd }} />
      {/* decorative backdrop: drifting orbs, outline rings, dotted grid */}
      <div className="gl-decor" aria-hidden>
        <span className="gl-orb gl-orb-1" />
        <span className="gl-orb gl-orb-2" />
        <span className="gl-ring gl-ring-1" />
        <span className="gl-ring gl-ring-2" />
      </div>

      <GymNav gymName={gym.name} logoUrl={gym.logo_url} joinHref={joinHref} signedIn={!!user} sections={navSections} />

      {/* ── Hero ──
          Order of what a visitor needs: who you are, whether you're open right
          now, what it costs, and how to join. The old hero led with a logo and
          a count of plan types. */}
      <header className="gl-hero gl-hero-photo">
        {/* Gym's own hero photo when set, else a bundled gym backdrop so the
            page never looks empty. A dark scrim keeps the text legible.
            This is the page's LCP element: `priority` preloads it and sets
            fetchPriority/decoding for us. */}
        <Image className="gl-hero-bg" src={gym.hero_image_url || '/images/gym-hero.jpg'} alt="" aria-hidden fill priority sizes="100vw" />
        <div className="gl-hero-scrim" aria-hidden />
        <div className="gl-hero-in">
          <span className="gl-logo">
            {gym.logo_url ? (
              <Image src={gym.logo_url} alt="" width={84} height={84} />
            ) : (
              <Dumbbell strokeWidth={1.9} />
            )}
          </span>

          {status && (
            <p className={`gl-status${status.open ? ' is-open' : ''}`}>
              <span className="gl-status-dot" aria-hidden />
              <b>{status.label}</b>
              {status.detail && <span>· {status.detail}</span>}
            </p>
          )}

          <h1 className="gl-name">{gym.name}</h1>
          {(gym.city || gym.state) && <p className="gl-loc"><MapPin size={14} strokeWidth={2} /> {[gym.city, gym.state].filter(Boolean).join(', ')}</p>}
          <p className="gl-tag">{gym.tagline || 'Check in, book classes and manage your membership — all from your phone.'}</p>

          {user ? (
            <div className="gl-cta">
              <Link href="/launch" className="gf-btn gf-btn-primary gf-btn-lg">Go to your dashboard <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} /></Link>
              <span className="gl-cta-note">Signed in as {user.email}</span>
            </div>
          ) : (
            // Join leads. Signing in is what returning members do — they know
            // where it is; a first-time visitor is who this page is for.
            <div className="gl-cta">
              <Link href={joinHref} className="gf-btn gf-btn-primary gf-btn-lg"><UserPlus strokeWidth={2} style={{ width: 17, height: 17 }} /> Join {gym.name}</Link>
              <Link href="/login" className="gf-btn gf-btn-secondary gf-btn-lg"><LogIn strokeWidth={2} style={{ width: 17, height: 17 }} /> Sign in</Link>
            </div>
          )}

          {/* Facts a person deciding whether to come in actually weighs. */}
          <div className="gl-facts">
            {fromPrice != null && (
              <a className="gl-fact" href="#plans">
                <span className="gl-fact-k">Membership from</span>
                <b>{fmtNaira(Math.round(fromPrice))}<small>/month</small></b>
              </a>
            )}
            {todayHours && (
              <div className="gl-fact">
                <span className="gl-fact-k">Today</span>
                <b>{todayHours}</b>
              </div>
            )}
            {daysPerWeek > 0 && (
              <div className="gl-fact">
                <span className="gl-fact-k">Open</span>
                <b>{daysPerWeek === 7 ? 'Every day' : `${daysPerWeek} days a week`}</b>
              </div>
            )}
            {classes.length > 0 && (
              <a className="gl-fact" href="#classes">
                <span className="gl-fact-k">Classes</span>
                <b>{classes.length}{classes.length === 24 ? '+' : ''} on the timetable</b>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── About ── */}
      {gym.description && (
        <Reveal><section className="gl-section" aria-labelledby="about-h">
          <h2 className="gl-h2" id="about-h">About {gym.name}</h2>
          <p className="gl-about">{gym.description}</p>
        </section></Reveal>
      )}

      {/* ── Membership plans ──
          Moved directly under the hero: this is the decision the page exists to
          support. It used to sit sixth, below an Instagram embed. */}
      {plans.length > 0 && (
        <Reveal><section className="gl-section" id="plans" aria-labelledby="plans-h">
          <h2 className="gl-h2" id="plans-h">Membership plans</h2>
          <p className="gl-section-lede">Pick a plan when you join — you can change it any time from your dashboard.</p>
          <div className="gl-plans">
            {plans.map((p) => {
              const feats = Array.isArray(p.features) ? (p.features as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 5) : [];
              const perMonth = monthlyEquivalent(p);
              const best = p.id === bestValueId;
              return (
                <Tilt className={`gl-plan${best ? ' is-best' : ''}`} key={p.id}>
                  {best && <span className="gl-plan-flag">Best value</span>}
                  <div className="gl-plan-name">{p.name}</div>
                  <div className="gl-plan-price">{p.price != null ? fmtNaira(Number(p.price)) : '—'}<small>{planPeriod(p)}</small></div>
                  {/* Only worth showing when it isn't just the price again. */}
                  {perMonth != null && (p.duration_months ?? 0) > 1 && (
                    <div className="gl-plan-permonth">≈ {fmtNaira(Math.round(perMonth))} a month</div>
                  )}
                  {p.description && <p className="gl-plan-desc">{p.description}</p>}
                  {feats.length > 0 && (
                    <ul className="gl-plan-feats">{feats.map((f, i) => <li key={i}><Check size={14} strokeWidth={2.5} /> {f}</li>)}</ul>
                  )}
                  {/* Carries the choice into the join flow — the old link dropped
                      it, so "Choose Gold" and "Join" led to identical screens. */}
                  <Link href={`${joinHref}?plan=${p.id}` as Route} className={`gf-btn ${best ? 'gf-btn-primary' : 'gf-btn-secondary'} gf-btn-sm gf-btn-full`} style={{ marginTop: 'auto' }}>
                    Choose {p.name}
                  </Link>
                </Tilt>
              );
            })}
          </div>
        </section></Reveal>
      )}

      {/* ── Classes: a timetable when the gym has scheduled them, cards when not ── */}
      {classes.length > 0 && (
        <Reveal><section className="gl-section" id="classes" aria-labelledby="classes-h">
          <h2 className="gl-h2" id="classes-h">Classes</h2>
          {scheduled.length > 0 ? (
            <>
              <p className="gl-section-lede">Book any of these from the app once you&apos;re a member.</p>
              <div className="gl-timetable">
                {WEEK.map((d) => {
                  const list = scheduled
                    .filter((c) => c.day_of_week === d)
                    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
                  if (list.length === 0) return null;
                  return (
                    <div className="gl-tt-day" key={d}>
                      <div className="gl-tt-dayname">
                        <b>{DAY_SHORT[d]}</b>
                        <span>{DAYS[d]}</span>
                      </div>
                      <ul className="gl-tt-list">
                        {list.map((c) => (
                          <li className="gl-tt-item" key={c.id}>
                            <time className="gl-tt-time">{fmt12Hr(String(c.start_time).slice(0, 5))}</time>
                            <span className="gl-tt-name">{c.name}</span>
                            <span className="gl-tt-meta">
                              {[c.duration_minutes ? `${c.duration_minutes} min` : null, c.level && c.level !== 'all' ? c.level : null].filter(Boolean).join(' · ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              {/* Classes with no day/time still exist — list them so the page
                  doesn't silently hide half the timetable. */}
              {classes.length > scheduled.length && (
                <div className="gl-classes" style={{ marginTop: 14 }}>
                  {classes.filter((c) => c.day_of_week == null || !c.start_time).map((c) => (
                    <div className="gl-class" key={c.id}>
                      <strong>{c.name}</strong>
                      <span>{[c.category, c.duration_minutes ? `${c.duration_minutes} min` : null].filter(Boolean).join(' · ') || 'Group class'}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="gl-classes">
              {classes.map((c) => (
                <Tilt className="gl-class" key={c.id} max={9}>
                  <strong>{c.name}</strong>
                  <span>{[c.category, c.duration_minutes ? `${c.duration_minutes} min` : null, c.level && c.level !== 'all' ? c.level : null].filter(Boolean).join(' · ') || 'Group class'}</span>
                </Tilt>
              ))}
            </div>
          )}
        </section></Reveal>
      )}

      {/* ── Amenities ── */}
      {amenities.length > 0 && (
        <Reveal><section className="gl-section" aria-labelledby="amenities-h">
          <h2 className="gl-h2" id="amenities-h">What&apos;s here</h2>
          <div className="gl-amenities">
            {amenities.map((a, i) => (
              <span className="gl-amenity" key={i}><Check size={15} strokeWidth={2.5} /> {a}</span>
            ))}
          </div>
        </section></Reveal>
      )}

      {/* ── Gallery ── */}
      {gallery.length > 0 && (
        <Reveal><section className="gl-section" id="gallery" aria-labelledby="gallery-h">
          <h2 className="gl-h2" id="gallery-h">Inside {gym.name}</h2>
          <div className="gl-gallery">
            {gallery.map((url, i) => (
              // `sizes` matters here: the grid is ~240px wide on a phone, and
              // without it next/image serves a viewport-width source for every
              // thumbnail — the single biggest byte cost on this page.
              <Image
                className="gl-gallery-img" src={url} alt={`${gym.name} photo ${i + 1}`} key={url}
                width={800} height={600} sizes="(max-width: 700px) 45vw, 240px"
              />
            ))}
          </div>
        </section></Reveal>
      )}

      {/* ── Hours & location: the two things a visitor checks last, together ── */}
      {(openDays.length > 0 || gym.address || gym.city || gym.phone || gym.email || gym.website) && (
        <Reveal><section className="gl-section" id="hours" aria-labelledby="visit-h">
          <h2 className="gl-h2" id="visit-h"><Clock size={17} strokeWidth={2} style={{ verticalAlign: '-3px', marginRight: 6 }} />Hours &amp; location</h2>
          <div className="gl-visit">
            {openDays.length > 0 && (() => {
              // Group rows by day so a day with morning + evening sessions renders
              // as one row with both ranges. Days with no rows are closed.
              const byDay = new Map<number, typeof hours>();
              for (const h of hours) {
                const list = byDay.get(h.day_of_week) ?? [];
                list.push(h);
                byDay.set(h.day_of_week, list);
              }
              const todayIdx = now.getDay();
              return (
                <div className="gl-hours">
                  {WEEK.map((d) => {
                    const rows = (byDay.get(d) ?? []).filter((r) => !r.is_closed && r.open_time);
                    return (
                      <div className={`gl-hours-row${d === todayIdx ? ' is-today' : ''}`} key={d}>
                        <span>{DAYS[d]}{d === todayIdx && <em> · today</em>}</span>
                        <span>
                          {rows.length === 0
                            ? 'Closed'
                            : rows.map((r) => `${fmt12Hr(String(r.open_time).slice(0, 5))} – ${fmt12Hr(String(r.close_time ?? '').slice(0, 5))}`).join(' · ')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div className="gl-contact" id="visit">
              {(gym.address || gym.city) && <div className="gl-contact-row"><MapPin size={16} strokeWidth={1.9} /><span>{[gym.address, gym.city, gym.state].filter(Boolean).join(', ')}</span></div>}
              {/* An address you can't navigate to is trivia. */}
              {directionsHref && (
                <a className="gl-contact-row gl-directions" href={directionsHref} target="_blank" rel="noreferrer">
                  <Navigation size={16} strokeWidth={1.9} /><span>Get directions</span>
                </a>
              )}
              {gym.phone && <a className="gl-contact-row" href={`tel:${gym.phone}`}><Phone size={16} strokeWidth={1.9} /><span>{gym.phone}</span></a>}
              {gym.email && <a className="gl-contact-row" href={`mailto:${gym.email}`}><Mail size={16} strokeWidth={1.9} /><span>{gym.email}</span></a>}
              {gym.website && <a className="gl-contact-row" href={gym.website} target="_blank" rel="noreferrer"><Globe size={16} strokeWidth={1.9} /><span>{gym.website.replace(/^https?:\/\//, '')}</span></a>}
              {socials.length > 0 && (
                <div className="gl-socials">
                  {socials.map((s) => (
                    <a key={s.key} className="gl-social" href={s.href(s.value)} target="_blank" rel="noreferrer" aria-label={s.label} title={s.label}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d={s.path} /></svg>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section></Reveal>
      )}

      {/* ── On Instagram (curated posts embedded via Instagram's official embed) ── */}
      {igPosts.length > 0 && (
        <Reveal><section className="gl-section" aria-labelledby="ig-h">
          <div className="gl-ig-head">
            <h2 className="gl-h2" id="ig-h" style={{ margin: 0 }}>On Instagram</h2>
            {igHandle && (
              <a className="gl-ig-follow" href={igHandle.startsWith('http') ? igHandle : `https://instagram.com/${igHandle.trim().replace(/^@+/, '')}`} target="_blank" rel="noreferrer">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden><path d={SOCIALS[0].path} /></svg>
                Follow @{igHandle.trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '')}
              </a>
            )}
          </div>
          <InstagramEmbeds urls={igPosts} />
        </section></Reveal>
      )}

      {/* ── The membership experience + app install, as ONE section ──
          These were two adjacent sections making the same pitch; the second
          repeated the first with badges attached. */}
      <Reveal><section className="gl-section" aria-labelledby="app-h">
        <h2 className="gl-h2" id="app-h">Your membership, in your pocket</h2>
        <div className="gl-features">
          {[
            { icon: QrCode, title: 'Tap to check in', body: `Scan or read out a code at the door — no cards, no queues. ${gym.name} sees you the moment you arrive.` },
            { icon: CalendarCheck, title: 'Book classes', body: 'Reserve your spot in seconds and get a reminder before it starts, so you never miss a session.' },
            { icon: Wallet, title: 'Manage your plan', body: 'Renew, view receipts and track your membership status — all self-service, all from your phone.' },
          ].map((f) => { const Icon = f.icon; return (
            <Tilt className="gl-feature" key={f.title} max={7}>
              <span className="gl-feature-ic"><Icon strokeWidth={1.8} /></span>
              <strong>{f.title}</strong>
              <p>{f.body}</p>
            </Tilt>
          ); })}
        </div>
        <div className="gl-app-cta">
          <p>Install it free on your phone — it works offline and sits on your home screen like any other app.</p>
          <AppInstall gymName={gym.name} />
        </div>
      </section></Reveal>

      {/* ── Footer CTA ── */}
      {!user && (
        <Reveal><section className="gl-final">
          <h2>Ready to train with {gym.name}?</h2>
          {status?.open && <p className="gl-final-note"><CalendarDays size={15} strokeWidth={2} /> Open right now — {status.detail}.</p>}
          <div className="gl-cta">
            <Link href={joinHref} className="gf-btn gf-btn-primary gf-btn-lg"><UserPlus strokeWidth={2} style={{ width: 17, height: 17 }} /> Join {gym.name}</Link>
            <Link href="/login" className="gf-btn gf-btn-secondary gf-btn-lg">I already have an account</Link>
          </div>
        </section></Reveal>
      )}

      <a className="gymland-by" href="https://gymflow.ng" target="_blank" rel="noreferrer">Powered by <strong>GymFlow</strong></a>

      <LandingTrackers ga4={integ.ga4} metaPixel={integ.meta_pixel} chatProvider={integ.chat_provider} chatId={integ.chat_id} />
    </main>
  );
}

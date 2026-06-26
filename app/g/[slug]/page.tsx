import type { CSSProperties } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRight, LogIn, UserPlus, Dumbbell, MapPin, Phone, Mail, Globe,
  Clock, Check, Users, CalendarDays, Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtNaira } from '@/lib/format';
import { Tilt, Reveal } from '@/components/marketing/landing-fx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Gym = {
  id: string; name: string; slug: string; logo_url: string | null; tagline: string | null;
  hero_image_url: string | null; brand_color: string | null; description: string | null;
  city: string | null; address: string | null; phone: string | null; email: string | null; website: string | null;
};
type Plan = { id: string; name: string; price: number | null; currency: string | null; duration_months: number | null; duration_days: number | null; description: string | null; features: unknown };
type Klass = { id: string; name: string; category: string | null; duration_minutes: number | null; level: string | null; description: string | null };
type Hours = { day_of_week: number; open_time: string | null; close_time: string | null; is_closed: boolean | null };

type GymPage = { gym: Gym; plans: Plan[]; classes: Klass[]; hours: Hours[]; members: number };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

  const [plansRes, classesRes, hoursRes, membersRes] = await Promise.all([
    db.from('membership_plans').select('id, name, price, currency, duration_months, duration_days, description, features').eq('gym_id', gym.id).eq('is_active', true).order('price', { ascending: true }),
    db.from('classes').select('id, name, category, duration_minutes, level, description').eq('gym_id', gym.id).eq('is_active', true).order('name', { ascending: true }).limit(9),
    db.from('business_hours').select('day_of_week, open_time, close_time, is_closed').eq('gym_id', gym.id).order('day_of_week', { ascending: true }),
    db.from('gym_member_links').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('is_active', true),
  ]);

  return {
    gym,
    plans: (plansRes.data as Plan[] | null) ?? [],
    classes: (classesRes.data as Klass[] | null) ?? [],
    hours: (hoursRes.data as Hours[] | null) ?? [],
    members: membersRes.count ?? 0,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadGymPage(slug);
  if (!page) return { title: 'Gym not found' };
  return {
    title: `${page.gym.name} — Members`,
    description: page.gym.tagline || page.gym.description || `Sign in or join ${page.gym.name}. Check in, book classes and manage your membership.`,
  };
}

function planPeriod(p: Plan): string {
  if (p.duration_months) return `/ ${p.duration_months === 1 ? 'month' : `${p.duration_months} months`}`;
  if (p.duration_days) return `/ ${p.duration_days === 1 ? 'day' : `${p.duration_days} days`}`;
  return '';
}

export default async function GymLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadGymPage(slug);
  if (!page) notFound();
  const { gym, plans, classes, hours, members } = page;

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
  const stats = [
    members > 0 ? { icon: Users, val: members >= 1000 ? `${(members / 1000).toFixed(1)}k` : String(members), lbl: members === 1 ? 'Member' : 'Members' } : null,
    classes.length > 0 ? { icon: CalendarDays, val: `${classes.length}${classes.length === 9 ? '+' : ''}`, lbl: 'Class types' } : null,
    plans.length > 0 ? { icon: Sparkles, val: String(plans.length), lbl: plans.length === 1 ? 'Plan' : 'Plans' } : null,
  ].filter(Boolean) as { icon: typeof Users; val: string; lbl: string }[];

  return (
    <main className="gymland" style={style}>
      {/* decorative backdrop: drifting orbs, outline rings, dotted grid */}
      <div className="gl-decor" aria-hidden>
        <span className="gl-orb gl-orb-1" />
        <span className="gl-orb gl-orb-2" />
        <span className="gl-ring gl-ring-1" />
        <span className="gl-ring gl-ring-2" />
      </div>

      {/* ── Hero ── */}
      <header className="gl-hero">
        {gym.hero_image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- per-gym remote hero image
          <img className="gl-hero-bg" src={gym.hero_image_url} alt="" aria-hidden />
        )}
        <div className="gl-hero-in">
          <span className="gl-logo">
            {gym.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- per-gym remote logo
              <img src={gym.logo_url} alt={gym.name} />
            ) : (
              <Dumbbell strokeWidth={1.9} />
            )}
          </span>
          <h1 className="gl-name">{gym.name}</h1>
          {gym.city && <p className="gl-loc"><MapPin size={14} strokeWidth={2} /> {gym.city}</p>}
          <p className="gl-tag">{gym.tagline || 'Check in, book classes and manage your membership — all from your phone.'}</p>

          {user ? (
            <div className="gl-cta">
              <Link href="/launch" className="gf-btn gf-btn-primary gf-btn-lg">Go to your dashboard <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} /></Link>
              <span className="gl-cta-note">Signed in as {user.email}</span>
            </div>
          ) : (
            <div className="gl-cta">
              <Link href="/login" className="gf-btn gf-btn-primary gf-btn-lg"><LogIn strokeWidth={2} style={{ width: 17, height: 17 }} /> Sign in</Link>
              <Link href={`/join/${gym.slug}`} className="gf-btn gf-btn-secondary gf-btn-lg"><UserPlus strokeWidth={2} style={{ width: 17, height: 17 }} /> Join {gym.name}</Link>
            </div>
          )}

          {stats.length > 0 && (
            <div className="gl-stats">
              {stats.map((s) => { const Icon = s.icon; return (
                <div className="gl-stat" key={s.lbl}><Icon size={16} strokeWidth={1.9} /><b>{s.val}</b><span>{s.lbl}</span></div>
              ); })}
            </div>
          )}
        </div>
      </header>

      {/* ── About ── */}
      {gym.description && (
        <Reveal><section className="gl-section">
          <h2 className="gl-h2">About</h2>
          <p className="gl-about">{gym.description}</p>
        </section></Reveal>
      )}

      {/* ── Membership plans ── */}
      {plans.length > 0 && (
        <Reveal><section className="gl-section">
          <h2 className="gl-h2">Membership plans</h2>
          <div className="gl-plans">
            {plans.map((p) => {
              const feats = Array.isArray(p.features) ? (p.features as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 5) : [];
              return (
                <Tilt className="gl-plan" key={p.id}>
                  <div className="gl-plan-name">{p.name}</div>
                  <div className="gl-plan-price">{p.price != null ? fmtNaira(Number(p.price)) : '—'}<small>{planPeriod(p)}</small></div>
                  {p.description && <p className="gl-plan-desc">{p.description}</p>}
                  {feats.length > 0 && (
                    <ul className="gl-plan-feats">{feats.map((f, i) => <li key={i}><Check size={14} strokeWidth={2.5} /> {f}</li>)}</ul>
                  )}
                  <Link href={`/join/${gym.slug}`} className="gf-btn gf-btn-secondary gf-btn-sm gf-btn-full" style={{ marginTop: 'auto' }}>Choose {p.name}</Link>
                </Tilt>
              );
            })}
          </div>
        </section></Reveal>
      )}

      {/* ── Classes ── */}
      {classes.length > 0 && (
        <Reveal><section className="gl-section">
          <h2 className="gl-h2">Classes</h2>
          <div className="gl-classes">
            {classes.map((c) => (
              <Tilt className="gl-class" key={c.id} max={9}>
                <strong>{c.name}</strong>
                <span>{[c.category, c.duration_minutes ? `${c.duration_minutes} min` : null, c.level && c.level !== 'all' ? c.level : null].filter(Boolean).join(' · ') || 'Group class'}</span>
              </Tilt>
            ))}
          </div>
        </section></Reveal>
      )}

      {/* ── Hours ── */}
      {openDays.length > 0 && (
        <Reveal><section className="gl-section">
          <h2 className="gl-h2"><Clock size={17} strokeWidth={2} style={{ verticalAlign: '-3px', marginRight: 6 }} />Opening hours</h2>
          <div className="gl-hours">
            {hours.map((h) => (
              <div className="gl-hours-row" key={h.day_of_week}>
                <span>{DAYS[h.day_of_week] ?? ''}</span>
                <span>{h.is_closed || !h.open_time ? 'Closed' : `${String(h.open_time).slice(0, 5)} – ${String(h.close_time ?? '').slice(0, 5)}`}</span>
              </div>
            ))}
          </div>
        </section></Reveal>
      )}

      {/* ── Contact ── */}
      {(gym.address || gym.city || gym.phone || gym.email || gym.website) && (
        <Reveal><section className="gl-section">
          <h2 className="gl-h2">Visit & contact</h2>
          <div className="gl-contact">
            {(gym.address || gym.city) && <div className="gl-contact-row"><MapPin size={16} strokeWidth={1.9} /><span>{[gym.address, gym.city].filter(Boolean).join(', ')}</span></div>}
            {gym.phone && <a className="gl-contact-row" href={`tel:${gym.phone}`}><Phone size={16} strokeWidth={1.9} /><span>{gym.phone}</span></a>}
            {gym.email && <a className="gl-contact-row" href={`mailto:${gym.email}`}><Mail size={16} strokeWidth={1.9} /><span>{gym.email}</span></a>}
            {gym.website && <a className="gl-contact-row" href={gym.website} target="_blank" rel="noreferrer"><Globe size={16} strokeWidth={1.9} /><span>{gym.website.replace(/^https?:\/\//, '')}</span></a>}
          </div>
        </section></Reveal>
      )}

      {/* ── Footer CTA ── */}
      {!user && (
        <Reveal><section className="gl-final">
          <h2>Ready to train with {gym.name}?</h2>
          <div className="gl-cta">
            <Link href={`/join/${gym.slug}`} className="gf-btn gf-btn-primary gf-btn-lg"><UserPlus strokeWidth={2} style={{ width: 17, height: 17 }} /> Join {gym.name}</Link>
            <Link href="/login" className="gf-btn gf-btn-secondary gf-btn-lg">I already have an account</Link>
          </div>
        </section></Reveal>
      )}

      <a className="gymland-by" href="https://gymflow.ng" target="_blank" rel="noreferrer">Powered by <strong>GymFlow</strong></a>
    </main>
  );
}

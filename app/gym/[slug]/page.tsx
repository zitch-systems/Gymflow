import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ThemeToggleButton } from '@/lib/theme';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type PageProps = { params: Promise<{ slug: string }> };

export default async function GymLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: gym } = await supabase
    .from('gyms')
    .select('id, name, slug, tagline, description, hero_image_url, address, phone, email, landing_enabled, landing_content, logo_url')
    .eq('slug', slug)
    .maybeSingle();
  if (!gym || gym.landing_enabled === false) {
    notFound();
  }

  const [{ data: classes }, { data: hours }, { data: plans }] = await Promise.all([
    supabase
      .from('class_schedules')
      .select('id, day_of_week, start_time, end_time, classes(name)')
      .eq('gym_id', gym!.id)
      .eq('is_active', true)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(12),
    supabase
      .from('business_hours')
      .select('day_of_week, open_time, close_time, is_closed')
      .eq('gym_id', gym!.id)
      .order('day_of_week', { ascending: true }),
    supabase
      .from('membership_plans')
      .select('id, name, duration_months, price')
      .eq('gym_id', gym!.id)
      .eq('is_active', true)
      .order('price', { ascending: true })
      .limit(4),
  ]);

  return (
    <div className="marketing">
      <nav className="marketing-nav">
        <div className="container marketing-nav-inner">
          <Link href="/" className="marketing-logo">
            <span className="marketing-logo-icon" aria-hidden>
              {gym.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gym.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
              ) : (
                (gym.name?.charAt(0) ?? 'G').toUpperCase()
              )}
            </span>
            <span>{gym.name}</span>
          </Link>
          <div className="marketing-nav-links">
            <Link href="/login" className="marketing-nav-link">Sign in</Link>
            <Link href="/join" className="gf-btn gf-btn-primary">Join</Link>
            <ThemeToggleButton />
          </div>
        </div>
      </nav>

      <header
        className="marketing-hero"
        style={
          gym.hero_image_url
            ? {
                background: `linear-gradient(rgba(8,14,28,0.55), rgba(8,14,28,0.85)), url(${gym.hero_image_url}) center/cover`,
                color: '#fff',
              }
            : undefined
        }
      >
        <div className="container">
          {gym.tagline && <span className="marketing-eyebrow">{gym.tagline}</span>}
          <h1 className="marketing-hero-title" style={gym.hero_image_url ? { color: '#fff' } : undefined}>
            {gym.name}
          </h1>
          {gym.description && (
            <p className="marketing-hero-sub" style={gym.hero_image_url ? { color: 'rgba(255,255,255,0.85)' } : undefined}>
              {gym.description}
            </p>
          )}
          <div className="marketing-hero-actions">
            <Link href="/join" className="gf-btn gf-btn-primary gf-btn-lg">
              Become a member
            </Link>
            <Link href="/login" className="gf-btn gf-btn-outline gf-btn-lg">
              I&apos;m already a member
            </Link>
          </div>
        </div>
      </header>

      {plans && plans.length > 0 && (
        <section className="marketing-section">
          <div className="container">
            <h2 className="marketing-section-title">Membership plans</h2>
            <div className="plan-grid">
              {plans.map((p) => (
                <article key={p.id} className="plan-card">
                  <h3 className="plan-card-title">{p.name}</h3>
                  <p className="plan-card-meta">
                    {p.duration_months} month{p.duration_months === 1 ? '' : 's'}
                  </p>
                  <p className="plan-card-price">₦{Number(p.price).toLocaleString('en-NG')}</p>
                  <Link href="/join" className="gf-btn gf-btn-primary gf-btn-full">
                    Pick this plan
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {classes && classes.length > 0 && (
        <section className="marketing-section">
          <div className="container">
            <h2 className="marketing-section-title">Classes this week</h2>
            <div className="marketing-grid">
              {classes.map((s) => {
                const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                return (
                  <article key={s.id} className="marketing-feature">
                    <h3 className="marketing-feature-title">{cls?.name ?? 'Class'}</h3>
                    <p className="marketing-feature-body">
                      {DAY_LABELS[s.day_of_week]} · {s.start_time} – {s.end_time}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="marketing-section">
        <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
          <article className="marketing-feature">
            <h3 className="marketing-feature-title">Hours</h3>
            {hours && hours.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: 'var(--gf-text-secondary)', fontSize: '0.95rem' }}>
                {hours.map((h) => (
                  <li key={h.day_of_week} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{DAY_LABELS[h.day_of_week]}</span>
                    <span>{h.is_closed ? 'Closed' : `${h.open_time ?? '—'} – ${h.close_time ?? '—'}`}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="marketing-feature-body">Open 6am – 10pm daily</p>
            )}
          </article>
          <article className="marketing-feature">
            <h3 className="marketing-feature-title">Visit</h3>
            <p className="marketing-feature-body">{gym.address ?? '—'}</p>
            <p className="marketing-feature-body">
              {gym.phone && (
                <a className="gf-link" href={`tel:${gym.phone}`}>
                  {gym.phone}
                </a>
              )}
              {gym.phone && gym.email && ' · '}
              {gym.email && (
                <a className="gf-link" href={`mailto:${gym.email}`}>
                  {gym.email}
                </a>
              )}
            </p>
          </article>
        </div>
      </section>

      {gym.landing_content && (
        <section className="marketing-section">
          <div className="container" style={{ maxWidth: 760, whiteSpace: 'pre-wrap', color: 'var(--gf-text-secondary)' }}>
            {gym.landing_content}
          </div>
        </section>
      )}

      <footer className="marketing-footer">
        <div className="container">
          <p>
            Powered by <Link href="https://gymflow.ng" className="gf-link">GymFlow</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

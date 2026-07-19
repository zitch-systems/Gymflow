import Link from 'next/link';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { Sparkles, Globe, TrendingUp, HeartPulse, BookOpen, ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'Careers',
  description: 'Help us build the future of fitness in Africa. Remote-friendly, Lagos-based, real ownership.',
  alternates: { canonical: '/careers' },
  openGraph: {
    title: 'Careers · GymFlow',
    description: 'Help us build the future of fitness in Africa. Remote-friendly, Lagos-based, real ownership.',
    url: '/careers',
    // Per-segment openGraph replaces (not merges) the root layout's — re-declare
    // the root OG image so it isn't dropped for this page.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Careers · GymFlow',
    description: 'Help us build the future of fitness in Africa. Remote-friendly, Lagos-based, real ownership.',
    images: ['/images/og.png'],
  },
};

const PERKS = [
  { icon: <Globe strokeWidth={1.75} />, title: 'Remote-friendly', body: 'Work from anywhere in Nigeria. We meet in Lagos a few days a month.' },
  { icon: <TrendingUp strokeWidth={1.75} />, title: 'Real ownership', body: 'Meaningful equity and the autonomy to ship things that matter.' },
  { icon: <HeartPulse strokeWidth={1.75} />, title: 'Health & gym', body: 'Private health cover and a paid membership at any gym on GymFlow.' },
  { icon: <BookOpen strokeWidth={1.75} />, title: 'Learning budget', body: 'An annual stipend for courses, books and conferences.' },
];

const ROLES = [
  { title: 'Senior Frontend Engineer', dept: 'Engineering', loc: 'Remote · Nigeria' },
  { title: 'Backend Engineer · Payments', dept: 'Engineering', loc: 'Remote · Nigeria' },
  { title: 'Product Designer', dept: 'Design', loc: 'Lagos / Hybrid' },
  { title: 'Customer Success Lead', dept: 'Success', loc: 'Lagos' },
  { title: 'Sales Development Rep', dept: 'Growth', loc: 'Lagos / Abuja' },
];

export default function CareersPage() {
  return (
    <>
      <MarketingNav />

      <main id="main-content">
      <header className="phero">
        <div className="wrap">
          <span className="eyebrow"><Sparkles strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Careers</span>
          <h1>Help us build the future of fitness in Africa.</h1>
          <p>We&apos;re a small, remote-friendly team based in Lagos, building software that hundreds of gyms rely on every day. Come do the best work of your career.</p>
        </div>
      </header>

      <section className="blk">
        <div className="wrap">
          <div className="sec-head"><h2>Why GymFlow</h2><p>What you get when you join the crew.</p></div>
          <div className="perks">
            {PERKS.map((p) => (
              <div className="feat" key={p.title}>
                <div className="feat-ic">{p.icon}</div>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="blk" style={{ background: 'var(--gf-surface)', borderTop: '1px solid var(--gf-border)', borderBottom: '1px solid var(--gf-border)' }}>
        <div className="wrap">
          <div className="sec-head"><h2>Open roles</h2><p>Don&apos;t see your role? Tell us anyway — we&apos;re always hiring exceptional people.</p></div>
          <div className="roles">
            {ROLES.map((r) => (
              <Link key={r.title} href={`/contact?role=${encodeURIComponent(r.title)}`} className="role-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="rinfo">
                  <h3>{r.title}</h3>
                  <div className="meta">
                    <span className="gf-badge gf-badge-brand">{r.dept}</span>
                    <span className="gf-badge gf-badge-neutral">{r.loc}</span>
                    <span className="gf-badge gf-badge-neutral">Full-time</span>
                  </div>
                </div>
                <span className="go">Apply <ArrowRight strokeWidth={2} /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="blk">
        <div className="wrap">
          <div className="cta">
            <h2>Nothing fits, but you&apos;re exceptional?</h2>
            <p>We&apos;d still love to hear from you. Tell us how you&apos;d make GymFlow better.</p>
            <div className="hero-cta" style={{ marginTop: 0 }}>
              <Link href="/contact?role=General%20application" className="gf-btn gf-btn-primary gf-btn-lg">Introduce yourself</Link>
              <Link href="/about" className="gf-btn gf-btn-outline gf-btn-lg">Meet the team</Link>
            </div>
          </div>
        </div>
      </section>

      </main>

      <MarketingFooter />
    </>
  );
}

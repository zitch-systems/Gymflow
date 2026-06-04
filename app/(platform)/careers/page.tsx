import Link from 'next/link';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { FeatureCard } from '@/components/marketing/sections';
import { Globe, TrendingUp, HeartPulse, BookOpen, ArrowRight, Sparkles } from 'lucide-react';

export const metadata = {
  title: 'Careers',
  description:
    'Help us build the future of fitness in Africa. A small, remote-friendly team in Lagos building software hundreds of Nigerian gyms rely on every day.',
};

const ROLES = [
  { title: 'Senior Frontend Engineer', team: 'Engineering', loc: 'Remote · Nigeria', type: 'Full-time' },
  { title: 'Backend Engineer · Payments', team: 'Engineering', loc: 'Remote · Nigeria', type: 'Full-time' },
  { title: 'Product Designer', team: 'Design', loc: 'Lagos / Hybrid', type: 'Full-time' },
  { title: 'Customer Success Lead', team: 'Success', loc: 'Lagos', type: 'Full-time' },
  { title: 'Sales Development Rep', team: 'Growth', loc: 'Lagos / Abuja', type: 'Full-time' },
];

export default function CareersPage() {
  return (
    <div className="marketing">
      <MarketingNav />
      <main id="main-content" tabIndex={-1}>
        <header className="marketing-hero">
          <div className="container">
            <span className="marketing-eyebrow"><Sparkles size={14} strokeWidth={2} /> Careers</span>
            <h1 className="marketing-hero-title">Help us build the future of fitness in Africa.</h1>
            <p className="marketing-hero-sub">
              We’re a small, remote-friendly team based in Lagos, building software that hundreds of gyms
              rely on every day. Come do the best work of your career.
            </p>
          </div>
        </header>

        <section className="marketing-section">
          <div className="container">
            <h2 className="marketing-section-title">Why GymFlow</h2>
            <p className="marketing-section-sub">What you get when you join the crew.</p>
            <div className="marketing-grid">
              <FeatureCard icon={Globe} title="Remote-friendly" body="Work from anywhere in Nigeria. We meet in Lagos a few days a month." />
              <FeatureCard icon={TrendingUp} title="Real ownership" body="Meaningful equity and the autonomy to ship things that matter." />
              <FeatureCard icon={HeartPulse} title="Health & gym" body="Private health cover and a paid membership at any gym on GymFlow." />
              <FeatureCard icon={BookOpen} title="Learning budget" body="An annual stipend for courses, books and conferences." />
            </div>
          </div>
        </section>

        <section className="marketing-section mk-roles-section">
          <div className="container">
            <h2 className="marketing-section-title">Open roles</h2>
            <p className="marketing-section-sub">
              Don’t see your role? Tell us anyway — we’re always hiring exceptional people.
            </p>
            <div className="mk-roles">
              {ROLES.map((r) => (
                <a
                  key={r.title}
                  className="mk-role-row"
                  href={`mailto:careers@gymflow.ng?subject=${encodeURIComponent('Application: ' + r.title)}`}
                >
                  <div className="mk-role-info">
                    <h3>{r.title}</h3>
                    <div className="mk-role-meta">
                      <span className="gf-badge gf-badge-brand">{r.team}</span>
                      <span className="gf-badge gf-badge-neutral">{r.loc}</span>
                      <span className="gf-badge gf-badge-neutral">{r.type}</span>
                    </div>
                  </div>
                  <span className="mk-role-go">Apply <ArrowRight size={16} strokeWidth={2} /></span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="marketing-section">
          <div className="container">
            <div className="mk-cta">
              <h2 className="mk-cta-title">Nothing fits, but you’re exceptional?</h2>
              <p className="mk-cta-sub">We’d still love to hear from you. Tell us how you’d make GymFlow better.</p>
              <div className="marketing-hero-actions" style={{ justifyContent: 'center' }}>
                <a href="mailto:careers@gymflow.ng?subject=General%20application" className="gf-btn gf-btn-primary gf-btn-lg">
                  Introduce yourself
                </a>
                <Link href="/about" className="gf-btn gf-btn-outline gf-btn-lg">Meet the team</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

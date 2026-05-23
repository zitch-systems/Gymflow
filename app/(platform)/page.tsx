import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';

export const metadata = {
  title: {
    absolute: 'GymFlow — Modern Gym Management for Nigerian Fitness Businesses',
  },
  description:
    'Member check-in, Paystack payments, classes, automation. Built in Lagos for Nigerian fitness businesses.',
};

export default function MarketingHome() {
  return (
    <div className="marketing">
      <nav className="marketing-nav">
        <div className="container marketing-nav-inner">
          <Link href="/" className="marketing-logo">
            <span className="marketing-logo-icon">G</span>
            <span>
              Gym<span className="marketing-logo-em">Flow</span>
            </span>
          </Link>
          <div className="marketing-nav-links">
            <Link href="#features" className="marketing-nav-link">
              Features
            </Link>
            <Link href="#pricing" className="marketing-nav-link">
              Pricing
            </Link>
            <Link href="#contact" className="marketing-nav-link">
              Contact
            </Link>
            <Link href="/login" className="marketing-nav-link">
              Sign in
            </Link>
            <Link href="/signup" className="gf-btn gf-btn-primary">
              Get started
            </Link>
            <ThemeToggleButton />
          </div>
        </div>
      </nav>

      <header className="marketing-hero">
        <div className="container">
          <span className="marketing-eyebrow">Built in Lagos · Made for Nigerian gyms</span>
          <h1 className="marketing-hero-title">
            Run your gym the <span className="marketing-accent">modern way</span>.
          </h1>
          <p className="marketing-hero-sub">
            Member check-in, Paystack subscriptions, class booking, and automated reminders — in one
            mobile-first platform that works on Naija data.
          </p>
          <div className="marketing-hero-actions">
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">
              Start free trial
            </Link>
            <Link href="#features" className="gf-btn gf-btn-outline gf-btn-lg">
              See features
            </Link>
          </div>
          <dl className="marketing-stats">
            <div>
              <dt>Members</dt>
              <dd>Unlimited</dd>
            </div>
            <div>
              <dt>Locations</dt>
              <dd>Multi-gym</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>99.9%</dd>
            </div>
          </dl>
        </div>
      </header>

      <section id="features" className="marketing-section">
        <div className="container">
          <h2 className="marketing-section-title">Everything your gym needs</h2>
          <p className="marketing-section-sub">
            From the front desk to the back office, GymFlow covers the day-to-day.
          </p>
          <div className="marketing-grid">
            <FeatureCard icon="🪪" title="QR check-in" body="Members scan a code; staff see attendance live. Works offline." />
            <FeatureCard icon="💳" title="Paystack subscriptions" body="Auto-renew, dunning, and saved cards — in Naira, no FX." />
            <FeatureCard icon="📅" title="Class scheduling" body="Recurring classes, booking caps, waitlists, RSVP reminders." />
            <FeatureCard icon="👥" title="Staff & roles" body="Owner, manager, front desk, accountant, instructor — each sees what they need." />
            <FeatureCard icon="📊" title="Live analytics" body="Revenue, churn, attendance — daily, monthly, exportable." />
            <FeatureCard icon="📲" title="PWA, installs anywhere" body="Add to home screen on Android & iOS. Push notifications optional." />
          </div>
        </div>
      </section>

      <section id="pricing" className="marketing-section marketing-pricing">
        <div className="container">
          <h2 className="marketing-section-title">Simple Naira pricing</h2>
          <p className="marketing-section-sub">One flat rate. No per-member fees.</p>
          <div className="marketing-price-card">
            <div className="marketing-price">
              <span className="marketing-price-amount">₦20,000</span>
              <span className="marketing-price-period">/month</span>
            </div>
            <ul className="marketing-price-list">
              <li>Unlimited members & staff</li>
              <li>Paystack payments built-in</li>
              <li>Multi-location ready</li>
              <li>WhatsApp & email reminders</li>
              <li>Daily backups</li>
            </ul>
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">
              Start 14-day free trial
            </Link>
          </div>
        </div>
      </section>

      <section id="contact" className="marketing-section marketing-contact">
        <div className="container">
          <h2 className="marketing-section-title">Get in touch</h2>
          <p className="marketing-section-sub">
            41 Ogudu Road, Lagos · 08166938327 ·{' '}
            <a href="mailto:hello@gymflow.ng">hello@gymflow.ng</a>
          </p>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="container">
          <p>© {new Date().getFullYear()} GymFlow · Made in Lagos · v2</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <article className="marketing-feature">
      <div className="marketing-feature-icon" aria-hidden>
        {icon}
      </div>
      <h3 className="marketing-feature-title">{title}</h3>
      <p className="marketing-feature-body">{body}</p>
    </article>
  );
}

import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import {
  ScanLine, CreditCard, CalendarDays, Users, BarChart3, Smartphone,
  UserPlus, QrCode, TrendingUp, Check,
  type LucideIcon,
} from 'lucide-react';

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
            <span className="marketing-logo-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19.5 7.2A8 8 0 1 0 20 12h-6" />
              </svg>
            </span>
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
            <FeatureCard icon={ScanLine} title="QR check-in" body="Members scan a code; staff see attendance live. Works offline." />
            <FeatureCard icon={CreditCard} title="Paystack subscriptions" body="Auto-renew, dunning, and saved cards — in Naira, no FX." />
            <FeatureCard icon={CalendarDays} title="Class scheduling" body="Recurring classes, booking caps, waitlists, RSVP reminders." />
            <FeatureCard icon={Users} title="Staff & roles" body="Owner, manager, front desk, accountant, instructor — each sees what they need." />
            <FeatureCard icon={BarChart3} title="Live analytics" body="Revenue, churn, attendance — daily, monthly, exportable." />
            <FeatureCard icon={Smartphone} title="PWA, installs anywhere" body="Add to home screen on Android & iOS. Push notifications optional." />
          </div>
        </div>
      </section>

      <section id="how" className="marketing-section mk-how">
        <div className="container">
          <h2 className="marketing-section-title">Live in an afternoon</h2>
          <p className="marketing-section-sub">No installs, no hardware. Three steps from signup to your first check-in.</p>
          <div className="mk-steps">
            <Step n={1} icon={UserPlus} title="Create your gym" body="Sign up at gymflow.ng and get a branded subdomain, admin login, and default pricing plans provisioned instantly." />
            <Step n={2} icon={QrCode} title="Print your QR" body="Download your static check-in QR from settings and post it at the entrance. Members scan to check in." />
            <Step n={3} icon={TrendingUp} title="Grow on autopilot" body="Paystack auto-renews subscriptions, reminders go out on WhatsApp & email, and analytics update live." />
          </div>
        </div>
      </section>

      <section id="pricing" className="marketing-section marketing-pricing">
        <div className="container">
          <h2 className="marketing-section-title">Simple Naira pricing</h2>
          <p className="marketing-section-sub">No per-member fees. Pay monthly, or commit longer and save.</p>
          <div className="marketing-price-card">
            <div className="marketing-price">
              <span className="marketing-price-amount">₦13,999</span>
              <span className="marketing-price-period">/month</span>
            </div>
            <p className="marketing-price-annual">
              or <strong>₦33,999/quarter</strong> · <strong>₦119,999/year</strong>
            </p>
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

      <section id="faq" className="marketing-section mk-faq-section">
        <div className="container">
          <h2 className="marketing-section-title">Questions, answered</h2>
          <p className="marketing-section-sub">Everything you need to know before you start.</p>
          <div className="mk-faq">
            <Faq q="Do my members need to download an app?" a="No. GymFlow is a PWA — members open your gym's link in any browser and can optionally add it to their home screen. It works on Android and iOS, even on slow connections." />
            <Faq q="How do payments work?" a="Members pay in Naira via Paystack (card or bank transfer). Cards are tokenised so renewals happen automatically. Funds settle into your gym's own Paystack subaccount — we never hold your money." />
            <Faq q="Is there a per-member fee?" a="No. From ₦13,999/month (₦33,999/quarter or ₦119,999/year) covers unlimited members and staff. The only other cost is Paystack's standard transaction fee, paid by you or passed to members." />
            <Faq q="Can I run more than one location?" a="Yes. Owners and managers can belong to multiple gyms with a single login, and each location gets its own branded subdomain and isolated data." />
            <Faq q="What about my members' data?" a="Every gym's data is isolated at the database level with row-level security. No gym can ever see another gym's members, payments, or check-ins." />
            <Faq q="How long does setup take?" a="Minutes. Signing up auto-provisions your subdomain, admin account, pricing plans, Paystack subaccount, and QR codes. You just add your logo and go." />
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="container">
          <div className="mk-cta">
            <h2 className="mk-cta-title">Ready to run your gym the modern way?</h2>
            <p className="mk-cta-sub">Start a 14-day free trial. No card required to begin.</p>
            <div className="marketing-hero-actions" style={{ justifyContent: 'center' }}>
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Start free trial</Link>
              <Link href="/login" className="gf-btn gf-btn-outline gf-btn-lg">Sign in</Link>
            </div>
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

function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <article className="marketing-feature">
      <div className="marketing-feature-icon" aria-hidden>
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <h3 className="marketing-feature-title">{title}</h3>
      <p className="marketing-feature-body">{body}</p>
    </article>
  );
}

function Step({ n, icon: Icon, title, body }: { n: number; icon: LucideIcon; title: string; body: string }) {
  return (
    <article className="mk-step">
      <div className="mk-step-top">
        <span className="mk-step-num">{n}</span>
        <span className="mk-step-icon" aria-hidden><Icon size={20} strokeWidth={1.75} /></span>
      </div>
      <h3 className="mk-step-title">{title}</h3>
      <p className="mk-step-body">{body}</p>
    </article>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="mk-faq-item">
      <summary className="mk-faq-q">
        <span>{q}</span>
        <span className="mk-faq-plus" aria-hidden><Check size={16} strokeWidth={2.5} /></span>
      </summary>
      <p className="mk-faq-a">{a}</p>
    </details>
  );
}

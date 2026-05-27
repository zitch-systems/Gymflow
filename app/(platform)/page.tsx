import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import {
  ScanLine, CreditCard, CalendarDays, Users, BarChart3, Smartphone,
  UserPlus, QrCode, TrendingUp, Check, Star, Flame, Wallet, MessageCircle,
  Mail, ShieldCheck, Bell,
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
            <Link href="#features" className="marketing-nav-link">Features</Link>
            <Link href="#how" className="marketing-nav-link">How it works</Link>
            <Link href="#pricing" className="marketing-nav-link">Pricing</Link>
            <Link href="#faq" className="marketing-nav-link">FAQ</Link>
            <Link href="/login" className="marketing-nav-link">Sign in</Link>
            <Link href="/signup" className="gf-btn gf-btn-primary">Get started</Link>
            <ThemeToggleButton />
          </div>
        </div>
      </nav>

      <header className="marketing-hero">
        <div className="container marketing-hero-grid">
          <div className="marketing-hero-copy">
            <span className="marketing-eyebrow">Built in Lagos · Made for Nigerian gyms</span>
            <h1 className="marketing-hero-title">
              Run your gym the <span className="marketing-accent">modern way</span>.
            </h1>
            <p className="marketing-hero-sub">
              Member check-in, Paystack subscriptions, class booking, and automated reminders — in one
              mobile-first platform that works on Naija data.
            </p>
            <div className="marketing-hero-actions">
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Start free trial</Link>
              <Link href="#features" className="gf-btn gf-btn-outline gf-btn-lg">See features</Link>
            </div>
            <dl className="marketing-stats">
              <div><dt>Members</dt><dd>Unlimited</dd></div>
              <div><dt>Locations</dt><dd>Multi-gym</dd></div>
              <div><dt>Uptime</dt><dd>99.9%</dd></div>
            </dl>
          </div>
          <HeroPreview />
        </div>
      </header>

      <section className="mk-integrations">
        <div className="container">
          <p className="mk-integrations-label">Works with the tools Nigerian gyms already use</p>
          <div className="mk-integrations-row">
            <span className="mk-integration"><CreditCard size={18} strokeWidth={1.75} /> Paystack</span>
            <span className="mk-integration"><MessageCircle size={18} strokeWidth={1.75} /> WhatsApp</span>
            <span className="mk-integration"><Mail size={18} strokeWidth={1.75} /> Email receipts</span>
            <span className="mk-integration"><Smartphone size={18} strokeWidth={1.75} /> Installable PWA</span>
            <span className="mk-integration"><ShieldCheck size={18} strokeWidth={1.75} /> Bank-grade RLS</span>
          </div>
        </div>
      </section>

      <section id="features" className="marketing-section">
        <div className="container">
          <h2 className="marketing-section-title">Everything your gym needs</h2>
          <p className="marketing-section-sub">From the front desk to the back office, GymFlow covers the day-to-day.</p>
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

      <section className="marketing-section mk-deepdive-section">
        <div className="container mk-deepdive">
          <div className="mk-deepdive-visual">
            <div className="mk-analytics-card">
              <div className="mk-analytics-head">
                <span>Revenue · last 6 months</span>
                <span className="gf-badge gf-badge-success"><span className="gf-dot" />+18%</span>
              </div>
              <div className="mk-analytics-bars">
                {[42, 55, 48, 67, 74, 92].map((h, i) => (
                  <span key={i} className="mk-analytics-bar" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="mk-analytics-foot">
                <div><span className="mk-analytics-kpi">₦4.2M</span><span className="mk-analytics-cap">collected</span></div>
                <div><span className="mk-analytics-kpi">312</span><span className="mk-analytics-cap">active members</span></div>
                <div><span className="mk-analytics-kpi">94%</span><span className="mk-analytics-cap">retention</span></div>
              </div>
            </div>
          </div>
          <div className="mk-deepdive-copy">
            <span className="marketing-eyebrow">Back office, automated</span>
            <h2 className="marketing-section-title" style={{ textAlign: 'left' }}>Stop chasing renewals and spreadsheets</h2>
            <p className="marketing-section-sub" style={{ textAlign: 'left', margin: '12px 0 20px' }}>
              GymFlow charges saved cards automatically, nudges expiring members on WhatsApp, logs every payment to
              your wallet, and shows revenue, churn, and attendance in real time.
            </p>
            <ul className="mk-checklist">
              <li><Check size={16} strokeWidth={2.5} /> Auto-debit renewals with smart retries &amp; grace periods</li>
              <li><Bell size={16} strokeWidth={2.5} /> Expiry reminders at 7, 3 &amp; 1 days — email + WhatsApp</li>
              <li><Wallet size={16} strokeWidth={2.5} /> Every payment settles to your own Paystack subaccount</li>
              <li><BarChart3 size={16} strokeWidth={2.5} /> P&amp;L, expenses, and exportable reports built in</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="marketing-section mk-testimonials-section">
        <div className="container">
          <h2 className="marketing-section-title">Loved by gym owners</h2>
          <p className="marketing-section-sub">Built with feedback from independent gyms across Nigeria.</p>
          <div className="mk-testimonials">
            <Testimonial
              quote="Auto-debit alone paid for itself in the first week. Renewals just happen now — I stopped sending manual reminders."
              name="Tunde A." gym="Powerhouse Fitness, Lagos" />
            <Testimonial
              quote="My front desk loves the QR check-in, and I finally see real numbers — who's active, who's lapsing, what we made."
              name="Ngozi E." gym="FlexZone, Abuja" />
            <Testimonial
              quote="Setup took an afternoon. Members add it to their home screen and it feels like our own app. No hardware to buy."
              name="Kelechi O." gym="IronWorks Gym, PH" />
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
              <li>Unlimited members &amp; staff</li>
              <li>Paystack payments built-in</li>
              <li>Multi-location ready</li>
              <li>WhatsApp &amp; email reminders</li>
              <li>Daily backups</li>
            </ul>
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">Start 14-day free trial</Link>
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

      <footer id="contact" className="marketing-footer">
        <div className="container mk-footer-grid">
          <div className="mk-footer-brand">
            <Link href="/" className="marketing-logo">
              <span className="marketing-logo-icon" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19.5 7.2A8 8 0 1 0 20 12h-6" />
                </svg>
              </span>
              <span>Gym<span className="marketing-logo-em">Flow</span></span>
            </Link>
            <p className="mk-footer-tag">Modern gym management for Nigerian fitness businesses.</p>
          </div>
          <div className="mk-footer-col">
            <h4>Product</h4>
            <Link href="#features">Features</Link>
            <Link href="#how">How it works</Link>
            <Link href="#pricing">Pricing</Link>
            <Link href="#faq">FAQ</Link>
          </div>
          <div className="mk-footer-col">
            <h4>Account</h4>
            <Link href="/signup">Start free trial</Link>
            <Link href="/login">Sign in</Link>
          </div>
          <div className="mk-footer-col">
            <h4>Get in touch</h4>
            <a href="mailto:hello@gymflow.ng">hello@gymflow.ng</a>
            <a href="tel:+2348166938327">0816 693 8327</a>
            <span className="mk-footer-muted">41 Ogudu Road, Lagos</span>
          </div>
        </div>
        <div className="container mk-footer-bottom">
          <span>© {new Date().getFullYear()} GymFlow · Made in Lagos</span>
          <span>Powered by Paystack · Supabase · Vercel</span>
        </div>
      </footer>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="mk-hero-visual" aria-hidden>
      <div className="mk-phone">
        <div className="mk-phone-notch" />
        <div className="mk-phone-screen">
          <div className="mk-phone-head">
            <span className="mk-phone-gym">Powerhouse Lagos</span>
            <span className="mk-phone-sub">Member Portal</span>
          </div>
          <div className="mk-phone-status">
            <div className="mk-phone-status-top">
              <span className="gf-badge gf-badge-success"><span className="gf-dot" />Active</span>
            </div>
            <div className="mk-phone-days">25</div>
            <div className="mk-phone-dayslabel">days remaining</div>
          </div>
          <div className="mk-phone-actions">
            {[ScanLine, CalendarDays, Wallet, Flame].map((Icon, i) => (
              <span key={i} className="mk-phone-action"><Icon size={16} strokeWidth={1.75} /></span>
            ))}
          </div>
          <div className="mk-phone-class">
            <div>
              <div className="mk-phone-class-name">Morning HIIT</div>
              <div className="mk-phone-class-meta">Tomorrow · 07:00</div>
            </div>
            <span className="gf-badge gf-badge-brand">Booked</span>
          </div>
          <div className="mk-phone-nav">
            {['', '', '', ''].map((_, i) => <span key={i} className={`mk-phone-tab${i === 0 ? ' active' : ''}`} />)}
          </div>
        </div>
      </div>
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

function Testimonial({ quote, name, gym }: { quote: string; name: string; gym: string }) {
  return (
    <article className="mk-testimonial">
      <div className="mk-stars" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={15} strokeWidth={0} fill="var(--gf-accent)" />)}
      </div>
      <p className="mk-testimonial-quote">“{quote}”</p>
      <div className="mk-testimonial-by">
        <span className="mk-testimonial-avatar" aria-hidden>{name.charAt(0)}</span>
        <span>
          <span className="mk-testimonial-name">{name}</span>
          <span className="mk-testimonial-gym">{gym}</span>
        </span>
      </div>
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

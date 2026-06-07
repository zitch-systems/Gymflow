import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { FeatureCard, Step, Testimonial } from '@/components/marketing/sections';
import {
  ScanLine, CreditCard, CalendarDays, Users, BarChart3, Smartphone,
  Rocket, QrCode, TrendingUp,
} from 'lucide-react';

export const metadata = {
  title: 'GymFlow — Run your gym the modern way',
  description:
    'Check-ins, Paystack subscriptions, class booking and automated reminders — one mobile-first platform built for Nigerian gyms.',
};

const GALLERY = [
  { src: '/images/gym-bikes.jpg', alt: 'Indoor cycling studio' },
  { src: '/images/gym-machines.jpg', alt: 'Resistance machines' },
  { src: '/images/gym-kettlebells.jpg', alt: 'Kettlebell rack' },
  { src: '/images/gym-barbell.jpg', alt: 'Barbell training area' },
];

export default function HomePage() {
  return (
    <div className="marketing">
      <MarketingNav />

      <main id="main-content" tabIndex={-1}>
        {/* Photo hero */}
        <header className="marketing-hero mk-hero-photo">
          <div
            className="mk-hero-photo-bg"
            style={{ backgroundImage: 'url(/images/gym-floor.jpg)' }}
            aria-hidden
          />
          <div className="container mk-hero-photo-inner">
            <span className="marketing-eyebrow">Built in Lagos · Made for Nigerian gyms</span>
            <h1 className="marketing-hero-title">
              Run your gym the <span className="marketing-accent">modern way</span>
            </h1>
            <p className="marketing-hero-sub">
              Check-ins, Paystack subscriptions, class booking and automated reminders — one
              mobile-first platform, light enough to fly on Nigerian networks.
            </p>
            <div className="marketing-hero-actions">
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
              <Link href="/features" className="gf-btn gf-btn-outline gf-btn-lg">Explore features</Link>
            </div>
            <dl className="marketing-stats">
              <div><dt>Members</dt><dd>Unlimited</dd></div>
              <div><dt>Locations</dt><dd>Multi-gym</dd></div>
              <div><dt>Uptime</dt><dd>99.9%</dd></div>
            </dl>
          </div>
        </header>

        {/* Features */}
        <section className="marketing-section">
          <div className="container">
            <h2 className="marketing-section-title">Everything your gym needs</h2>
            <p className="marketing-section-sub">
              From the front desk to the back office, GymFlow covers the day-to-day.
            </p>
            <div className="marketing-grid">
              <FeatureCard icon={ScanLine} title="QR check-in" body="Members scan a code; staff see attendance live. Works offline." />
              <FeatureCard icon={CreditCard} title="Paystack subscriptions" body="Auto-renew, dunning, and saved cards — in Naira, no FX." />
              <FeatureCard icon={CalendarDays} title="Class scheduling" body="Recurring classes, booking caps, waitlists and RSVP reminders." />
              <FeatureCard icon={Users} title="Staff & roles" body="Owner, manager, front desk, accountant, instructor — each sees what they need." />
              <FeatureCard icon={BarChart3} title="Live analytics" body="Revenue, churn, attendance — daily, monthly, exportable." />
              <FeatureCard icon={Smartphone} title="Installs anywhere" body="Add to home screen on Android & iOS. Push notifications optional." />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="marketing-section mk-gallery-strip">
          <div className="container">
            <h2 className="marketing-section-title">Live in an afternoon</h2>
            <p className="marketing-section-sub">
              No installs, no hardware. Three steps from signup to your first check-in.
            </p>
            <div className="mk-steps">
              <Step n={1} icon={Rocket} title="Create your gym" body="Sign up and get a branded subdomain, admin login, and default pricing plans provisioned instantly." />
              <Step n={2} icon={QrCode} title="Print your QR" body="Download your static check-in QR from settings and post it at the entrance. Members scan to check in." />
              <Step n={3} icon={TrendingUp} title="Grow on autopilot" body="Paystack auto-renews subscriptions, reminders go out on WhatsApp & email, and analytics update live." />
            </div>
          </div>
        </section>

        {/* Gallery */}
        <section className="marketing-section">
          <div className="container">
            <h2 className="marketing-section-title">Made for real gyms</h2>
            <p className="marketing-section-sub">From boutique studios to multi-floor facilities.</p>
            <div className="mk-gallery">
              {GALLERY.map((g) => (
                <div key={g.src} className="mk-gallery-item">
                  <Image src={g.src} alt={g.alt} width={600} height={800} loading="lazy" sizes="(max-width: 760px) 50vw, 25vw" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="marketing-section mk-gallery-strip">
          <div className="container">
            <h2 className="marketing-section-title">Loved by gym owners</h2>
            <p className="marketing-section-sub">Built with feedback from independent gyms across Nigeria.</p>
            <div className="mk-testimonials">
              <Testimonial quote="Auto-debit alone paid for itself in the first week. Renewals just happen now — I stopped sending manual reminders." name="Tunde A." gym="Powerhouse Fitness, Lagos" />
              <Testimonial quote="My front desk loves the QR check-in, and I finally see real numbers — who's active, who's lapsing, what we made." name="Ngozi E." gym="FlexZone, Abuja" />
              <Testimonial quote="Setup took an afternoon. Members add it to their home screen and it feels like our own app. No hardware to buy." name="Kelechi O." gym="IronWorks Gym, PH" />
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="marketing-section">
          <div className="container">
            <div className="mk-cta">
              <h2 className="mk-cta-title">Ready to run your gym the modern way?</h2>
              <p className="mk-cta-sub">Launch your gym in an afternoon. From ₦13,999/mo · cancel anytime · no setup fees.</p>
              <div className="marketing-hero-actions" style={{ justifyContent: 'center' }}>
                <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
                <Link href="/pricing" className="gf-btn gf-btn-outline gf-btn-lg">See pricing</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import { preload } from 'react-dom';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { FeatureCard, Step, Testimonial } from '@/components/marketing/sections';
import {
  ScanLine, CreditCard, CalendarDays, Users, BarChart3, Smartphone,
  UserPlus, QrCode, TrendingUp, MessageCircle, Mail, ShieldCheck, ArrowRight,
} from 'lucide-react';

export const metadata = {
  title: { absolute: 'GymFlow — Modern Gym Management for Nigerian Fitness Businesses' },
  description: 'Member check-in, Paystack payments, classes, automation. Built in Lagos for Nigerian fitness businesses.',
};

const GALLERY = [
  { src: '/images/gym-bikes.jpg', alt: 'Air bikes with a mountain view' },
  { src: '/images/gym-machines.jpg', alt: 'Machines and lockers' },
  { src: '/images/gym-kettlebells.jpg', alt: 'Kettlebells and dumbbells by the window' },
  { src: '/images/gym-barbell.jpg', alt: 'Loaded barbell on the floor' },
];

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}/#org`,
      name: 'GymFlow',
      url: SITE,
      logo: `${SITE}/icon.svg`,
      areaServed: 'NG',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '41 Ogudu Road',
        addressLocality: 'Lagos',
        addressCountry: 'NG',
      },
      contactPoint: [{
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: 'hello@gymflow.ng',
        telephone: '+234-816-693-8327',
        areaServed: 'NG',
        availableLanguage: ['en'],
      }],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE}/#app`,
      name: 'GymFlow',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS (PWA), Android (PWA)',
      description: 'Multi-tenant gym management SaaS for Nigerian fitness businesses: QR check-in, Paystack subscriptions, class scheduling, automated reminders, analytics.',
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'NGN',
        lowPrice: '13999',
        highPrice: '119999',
        offerCount: 3,
      },
      provider: { '@id': `${SITE}/#org` },
    },
  ],
};

export default function MarketingHome() {
  // The hero is a CSS `background-image: url(...)` so Next/the browser can't
  // discover it until CSS finishes parsing — that delays LCP. Use React 19's
  // `preload()` so a `<link rel="preload" as="image" fetchpriority="high">`
  // ships in <head>, which the preload scanner picks up immediately.
  preload('/images/gym-floor.jpg', { as: 'image', fetchPriority: 'high' });

  return (
    <div className="marketing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <MarketingNav />

      <main id="main-content" tabIndex={-1}>
      <header className="marketing-hero mk-hero-photo">
        <div className="mk-hero-photo-bg" style={{ backgroundImage: 'url(/images/gym-floor.jpg)' }} aria-hidden />
        <div className="container mk-hero-photo-inner">
          <span className="marketing-eyebrow">Built in Lagos · Made for Nigerian gyms</span>
          <h1 className="marketing-hero-title">
            Run your gym the <span className="marketing-accent">modern way</span>.
          </h1>
          <p className="marketing-hero-sub">
            Member check-in, Paystack subscriptions, class booking, and automated reminders — in one
            mobile-first platform that works on Naija data.
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

      <section className="marketing-section">
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
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <Link href="/features" className="gf-btn gf-btn-secondary">See all features <ArrowRight size={16} strokeWidth={2} /></Link>
          </div>
        </div>
      </section>

      <section id="how" className="marketing-section mk-how">
        <div className="container">
          <h2 className="marketing-section-title">Live in an afternoon</h2>
          <p className="marketing-section-sub">No installs, no hardware. Three steps from signup to your first check-in.</p>
          <div className="mk-steps">
            <Step n={1} icon={UserPlus} title="Create your gym" body="Sign up and get a branded subdomain, admin login, and default pricing plans provisioned instantly." />
            <Step n={2} icon={QrCode} title="Print your QR" body="Download your static check-in QR from settings and post it at the entrance. Members scan to check in." />
            <Step n={3} icon={TrendingUp} title="Grow on autopilot" body="Paystack auto-renews subscriptions, reminders go out on WhatsApp & email, and analytics update live." />
          </div>
        </div>
      </section>

      <section className="mk-gallery-strip">
        <div className="container">
          <h2 className="marketing-section-title">Made for real gyms</h2>
          <p className="marketing-section-sub">From boutique studios to multi-floor facilities.</p>
          <div className="mk-gallery">
            {GALLERY.map((g) => (
              <div key={g.src} className="mk-gallery-item">
                <Image
                  src={g.src}
                  alt={g.alt}
                  width={480}
                  height={720}
                  sizes="(max-width: 768px) 50vw, 25vw"
                  loading="lazy"
                  style={{ width: '100%', height: 'auto' }}
                />
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link href="/about" className="gf-btn gf-btn-secondary">View the gallery <ArrowRight size={16} strokeWidth={2} /></Link>
          </div>
        </div>
      </section>

      <section className="marketing-section mk-testimonials-section">
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

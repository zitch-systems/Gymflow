import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { FeatureCard } from '@/components/marketing/sections';
import { HeartHandshake, Gauge, ShieldCheck, MapPin } from 'lucide-react';

export { aboutMetadata as metadata } from './metadata';

const GALLERY = [
  { src: '/images/gym-studio.jpg', alt: 'Cardio studio' },
  { src: '/images/gym-machines.jpg', alt: 'Resistance machines' },
  { src: '/images/gym-bikes.jpg', alt: 'Indoor cycling' },
  { src: '/images/gym-kettlebells.jpg', alt: 'Kettlebell rack' },
  { src: '/images/gym-barbell.jpg', alt: 'Barbell platform' },
  { src: '/images/gym-dumbbells.jpg', alt: 'Dumbbell wall' },
  { src: '/images/gym-floor.jpg', alt: 'Main training floor' },
  { src: '/images/gym-hero.jpg', alt: 'Members training' },
];

export default function AboutPage() {
  return (
    <div className="marketing">
      <MarketingNav />

      <main id="main-content" tabIndex={-1}>
        <header className="marketing-hero mk-subhero">
          <div className="container">
            <span className="marketing-eyebrow">Our story</span>
            <h1 className="marketing-hero-title">
              Built in Lagos, for the gyms that <span className="marketing-accent">built us</span>
            </h1>
            <p className="marketing-hero-sub">
              GymFlow began on a whiteboard in a Yaba co-working space — three friends frustrated
              that running a great gym meant drowning in spreadsheets, missed renewals and manual
              WhatsApp reminders. Today, hundreds of gyms across Nigeria run on it.
            </p>
          </div>
        </header>

        {/* Values */}
        <section className="marketing-section">
          <div className="container">
            <h2 className="marketing-section-title">What we believe</h2>
            <p className="marketing-section-sub">The principles behind every release.</p>
            <div className="marketing-grid">
              <FeatureCard icon={HeartHandshake} title="Built for operators" body="Every feature starts with a real gym owner's day — not a spreadsheet of abstractions." />
              <FeatureCard icon={Gauge} title="Fast on any network" body="A light, mobile-first PWA that loads quickly on 3G and works offline at the door." />
              <FeatureCard icon={ShieldCheck} title="Your data, isolated" body="Row-level security per tenant. No gym can ever see another gym's members or money." />
              <FeatureCard icon={MapPin} title="Made for Naira" body="Paystack-native pricing, auto-debit and payouts — no FX, no workarounds." />
            </div>
          </div>
        </section>

        {/* Gallery */}
        <section className="marketing-section mk-gallery-strip">
          <div className="container">
            <h2 className="marketing-section-title">The gyms that run on GymFlow</h2>
            <p className="marketing-section-sub">
              From boutique studios to multi-floor facilities — a look inside the spaces our
              software keeps moving every day.
            </p>
            <div className="mk-gallery">
              {GALLERY.map((g) => (
                <div key={g.src} className="mk-gallery-item">
                  <Image src={g.src} alt={g.alt} width={600} height={800} loading="lazy" sizes="(max-width: 760px) 50vw, 25vw" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="marketing-section">
          <div className="container">
            <div className="mk-cta">
              <h2 className="mk-cta-title">Join the gyms growing with GymFlow</h2>
              <p className="mk-cta-sub">Launch your branded instance in an afternoon.</p>
              <div className="marketing-hero-actions" style={{ justifyContent: 'center' }}>
                <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
                <Link href="/features" className="gf-btn gf-btn-outline gf-btn-lg">See features</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { Camera } from 'lucide-react';

export const metadata = {
  title: 'Gallery',
  description:
    'The gyms that run on GymFlow — from boutique studios to multi-floor facilities across Nigeria.',
};

const SHOTS = [
  { src: '/images/gym-floor.jpg', alt: 'Main training floor', cap: 'Powerhouse Fitness · Lagos' },
  { src: '/images/gym-bikes.jpg', alt: 'Spin studio', cap: 'Spin studio · FlexZone, Abuja' },
  { src: '/images/gym-machines.jpg', alt: 'Resistance machines', cap: 'Strength floor · IronWorks, PH' },
  { src: '/images/gym-kettlebells.jpg', alt: 'Kettlebells', cap: 'Functional zone · Apex Arena' },
  { src: '/images/gym-barbell.jpg', alt: 'Loaded barbell', cap: 'Olympic platforms · FitHub' },
  { src: '/images/gym-studio.jpg', alt: 'Class studio', cap: 'Class studio · Summit Fitness' },
  { src: '/images/gym-dumbbells.jpg', alt: 'Free weights', cap: 'Free weights · The Yard' },
  { src: '/images/gym-hero.jpg', alt: 'Personal training session', cap: 'Personal training · Elevate' },
];

export default function GalleryPage() {
  return (
    <div className="marketing">
      <MarketingNav />
      <main id="main-content" tabIndex={-1}>
        <header className="marketing-hero">
          <div className="container">
            <span className="marketing-eyebrow"><Camera size={14} strokeWidth={2} /> Gallery</span>
            <h1 className="marketing-hero-title">The gyms that run on GymFlow.</h1>
            <p className="marketing-hero-sub">
              From boutique studios to multi-floor facilities — a look inside the spaces our software keeps
              moving every day.
            </p>
          </div>
        </header>

        <section className="marketing-section">
          <div className="container">
            <div className="mk-galx">
              {SHOTS.map((s) => (
                <figure key={s.src}>
                  <Image src={s.src} alt={s.alt} width={480} height={360} sizes="(max-width: 520px) 100vw, (max-width: 860px) 50vw, 33vw" loading="lazy" />
                  <figcaption>{s.cap}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="marketing-section" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="mk-cta">
              <h2 className="mk-cta-title">Your gym could be next.</h2>
              <p className="mk-cta-sub">Launch in an afternoon. From ₦13,999/mo · cancel anytime · no setup fees.</p>
              <div className="marketing-hero-actions" style={{ justifyContent: 'center' }}>
                <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
                <Link href="/contact" className="gf-btn gf-btn-outline gf-btn-lg">Book a demo</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

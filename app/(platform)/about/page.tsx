import Link from 'next/link';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';

export const metadata = {
  title: 'Gallery',
  description: 'GymFlow — built in Lagos for Nigerian fitness businesses. A look at the gyms we power.',
};

const PHOTOS = [
  { src: '/images/gym-hero.jpg', alt: 'Treadmill by floor-to-ceiling windows', span: true },
  { src: '/images/gym-floor.jpg', alt: 'Strength machines on the gym floor' },
  { src: '/images/gym-dumbbells.jpg', alt: 'Dumbbell rack close-up' },
  { src: '/images/gym-bikes.jpg', alt: 'Air bikes with a mountain view', span: true },
  { src: '/images/gym-kettlebells.jpg', alt: 'Kettlebells and dumbbell rack by the window' },
  { src: '/images/gym-barbell.jpg', alt: 'Loaded Olympic barbell on the floor' },
  { src: '/images/gym-machines.jpg', alt: 'Machines and lockers on a wood floor' },
  { src: '/images/gym-studio.jpg', alt: 'Cardio studio with treadmills and lockers' },
  { src: '/images/gym-kettlebell.jpg', alt: 'Kettlebell close-up on the rack' },
];

export default function AboutPage() {
  return (
    <div className="marketing">
      <MarketingNav />

      <header className="marketing-hero mk-subhero">
        <div className="container">
          <span className="marketing-eyebrow">Built in Lagos</span>
          <h1 className="marketing-hero-title">Software for the gyms that move Nigeria</h1>
          <p className="marketing-hero-sub">
            From boutique studios to multi-floor facilities, GymFlow gives independent gyms the tools big
            chains take for granted — without the price tag or the hardware.
          </p>
        </div>
      </header>

      <section className="marketing-section" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="mk-masonry">
            {PHOTOS.map((p) => (
              <figure key={p.src} className={`mk-masonry-item${p.span ? ' span' : ''}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.alt} loading="lazy" />
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section mk-stats-band">
        <div className="container">
          <div className="mk-statgrid">
            <div><span className="mk-statgrid-num">5 min</span><span className="mk-statgrid-cap">to launch a gym</span></div>
            <div><span className="mk-statgrid-num">0</span><span className="mk-statgrid-cap">hardware to buy</span></div>
            <div><span className="mk-statgrid-num">100%</span><span className="mk-statgrid-cap">Naira, no FX</span></div>
            <div><span className="mk-statgrid-num">24/7</span><span className="mk-statgrid-cap">member self-service</span></div>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="container" style={{ maxWidth: 720, textAlign: 'center' }}>
          <h2 className="marketing-section-title">Why we built GymFlow</h2>
          <p className="marketing-section-sub" style={{ margin: '14px 0 0' }}>
            Most gym software is priced for the West, charges per member, and assumes fast data and foreign cards.
            GymFlow is the opposite: one flat Naira price, Paystack-native, WhatsApp-first, and fast on any phone.
            We handle check-ins, payments, classes, staff and analytics so you can focus on your members.
          </p>
          <div className="marketing-hero-actions" style={{ justifyContent: 'center', marginTop: 24 }}>
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Start free trial</Link>
            <Link href="/features" className="gf-btn gf-btn-outline gf-btn-lg">Explore features</Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

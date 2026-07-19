import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { Image as ImageIcon } from 'lucide-react';

export const metadata = {
  title: 'Gallery',
  description: 'The gyms that run on GymFlow — from boutique studios to multi-floor facilities.',
  alternates: { canonical: '/gallery' },
  openGraph: {
    title: 'Gallery · GymFlow',
    description: 'The gyms that run on GymFlow — from boutique studios to multi-floor facilities.',
    url: '/gallery',
    // Per-segment openGraph replaces (not merges) the root layout's — re-declare
    // the root OG image so it isn't dropped for this page.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gallery · GymFlow',
    description: 'The gyms that run on GymFlow — from boutique studios to multi-floor facilities.',
    images: ['/images/og.png'],
  },
};

const SHOTS = [
  { img: 'gym-floor', cap: 'Powerhouse Fitness · Lagos' },
  { img: 'gym-bikes', cap: 'Spin studio · FlexZone, Abuja' },
  { img: 'gym-machines', cap: 'Strength floor · IronWorks, PH' },
  { img: 'gym-kettlebells', cap: 'Functional zone · Apex Arena' },
  { img: 'gym-barbell', cap: 'Olympic platforms · FitHub' },
  { img: 'gym-studio', cap: 'Class studio · Summit Fitness' },
  { img: 'gym-dumbbells', cap: 'Free weights · The Yard' },
  { img: 'gym-hero', cap: 'Personal training · Elevate' },
];

export default function GalleryPage() {
  return (
    <>
      <MarketingNav />

      <main id="main-content">
      <header className="phero">
        <div className="wrap">
          <span className="eyebrow"><ImageIcon strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Gallery</span>
          <h1>The gyms that run on GymFlow.</h1>
          <p>From boutique studios to multi-floor facilities — a look inside the spaces our software keeps moving every day.</p>
        </div>
      </header>

      <section className="blk">
        <div className="wrap">
          <div className="galx">
            {SHOTS.map((s) => (
              <figure key={s.img}>
                <Image src={`/images/${s.img}.jpg`} alt={s.cap} width={400} height={500} sizes="(max-width:860px) 100vw, 360px" />
                <figcaption>{s.cap}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="cta">
            <h2>Your gym could be next.</h2>
            <p>Launch in an afternoon. From ₦13,999/mo · cancel anytime · no setup fees.</p>
            <div className="hero-cta" style={{ marginTop: 0 }}>
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
            </div>
          </div>
        </div>
      </section>

      </main>

      <MarketingFooter />
    </>
  );
}

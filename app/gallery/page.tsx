import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BreadcrumbLd } from '@/components/marketing/breadcrumb-ld';
import { Image as ImageIcon } from 'lucide-react';

const galleryDescription = 'Illustrative gym environments and workflows GymFlow is designed to support.';

export const metadata = {
  title: 'Gallery',
  description: galleryDescription,
  alternates: { canonical: '/gallery' },
  openGraph: {
    title: 'Gallery · GymFlow',
    description: galleryDescription,
    url: '/gallery',
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gallery · GymFlow',
    description: galleryDescription,
    images: ['/images/og.png'],
  },
};

const SHOTS = [
  { img: 'gym-floor', cap: 'Training floor' },
  { img: 'gym-bikes', cap: 'Indoor cycling' },
  { img: 'gym-machines', cap: 'Strength equipment' },
  { img: 'gym-kettlebells', cap: 'Functional training' },
  { img: 'gym-barbell', cap: 'Barbell stations' },
  { img: 'gym-studio', cap: 'Class studio' },
  { img: 'gym-dumbbells', cap: 'Free weights' },
  { img: 'gym-hero', cap: 'Personal training' },
];

export default function GalleryPage() {
  return (
    <>
      <BreadcrumbLd name="Gallery" path="/gallery" />
      <MarketingNav />

      <main id="main-content">
        <header className="phero">
          <div className="wrap">
            <span className="eyebrow"><ImageIcon strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Gallery</span>
            <h1>Built for every corner of the gym.</h1>
            <p>Illustrative gym environments showing the kinds of spaces and workflows GymFlow is designed to support.</p>
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
              <h2>Bring your gym&apos;s workflows into one place.</h2>
              <p>Plans start from ₦13,999/mo · cancel anytime · no setup fees.</p>
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

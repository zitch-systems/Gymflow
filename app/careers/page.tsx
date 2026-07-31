import Link from 'next/link';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BreadcrumbLd } from '@/components/marketing/breadcrumb-ld';
import { Sparkles } from 'lucide-react';

const careersDescription = 'GymFlow careers and verified hiring updates.';

export const metadata = {
  title: 'Careers',
  description: careersDescription,
  alternates: { canonical: '/careers' },
  openGraph: {
    title: 'Careers · GymFlow',
    description: careersDescription,
    url: '/careers',
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Careers · GymFlow',
    description: careersDescription,
    images: ['/images/og.png'],
  },
};

export default function CareersPage() {
  return (
    <>
      <BreadcrumbLd name="Careers" path="/careers" />
      <MarketingNav />

      <main id="main-content">
        <header className="phero">
          <div className="wrap">
            <span className="eyebrow"><Sparkles strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Careers</span>
            <h1>Careers at GymFlow.</h1>
            <p>Verified openings will be published here when they are available.</p>
          </div>
        </header>

        <section className="blk">
          <div className="wrap">
            <div className="cta">
              <h2>No advertised openings right now.</h2>
              <p>We do not have a verified role to list at the moment. For a general business enquiry, contact the GymFlow team.</p>
              <div className="hero-cta" style={{ marginTop: 0 }}>
                <Link href="/contact" className="gf-btn gf-btn-primary gf-btn-lg">Contact GymFlow</Link>
                <Link href="/about" className="gf-btn gf-btn-outline gf-btn-lg">About GymFlow</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}

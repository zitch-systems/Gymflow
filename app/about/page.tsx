import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BreadcrumbLd } from '@/components/marketing/breadcrumb-ld';
import { Building2, Zap, Feather, ShieldCheck } from 'lucide-react';

const aboutDescription = 'GymFlow builds mobile-first gym management software for Nigerian fitness businesses.';

export const metadata = {
  title: 'About',
  description: aboutDescription,
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About · GymFlow',
    description: aboutDescription,
    url: '/about',
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About · GymFlow',
    description: aboutDescription,
    images: ['/images/og.png'],
  },
};

const VALUES = [
  { icon: <Zap strokeWidth={1.75} />, title: 'Local by design', body: 'Naira pricing, Paystack payments and mobile-first workflows for Nigerian gym operations.' },
  { icon: <Feather strokeWidth={1.75} />, title: 'Simple beats clever', body: 'Core front-desk and member tasks should be clear, quick and easy to learn.' },
  { icon: <ShieldCheck strokeWidth={1.75} />, title: 'Trust is the product', body: 'Role-scoped access and tenant boundaries protect each gym and its members.' },
];

export default function AboutPage() {
  return (
    <>
      <BreadcrumbLd name="About" path="/about" />
      <MarketingNav cur="about" />

      <main id="main-content">
        <header className="phero">
          <div className="wrap">
            <span className="eyebrow"><Building2 strokeWidth={1.75} style={{ width: 14, height: 14 }} /> About GymFlow</span>
            <h1>Gym management designed for Nigerian fitness businesses.</h1>
            <p>GymFlow brings memberships, check-ins, classes, payments and day-to-day operations into one mobile-first workspace.</p>
          </div>
        </header>

        <section className="blk">
          <div className="wrap split">
            <Image src="/images/gym-floor.jpg" alt="Gym floor" width={620} height={460} sizes="(max-width:860px) 100vw, 50vw" />
            <div>
              <h2>Software that fits the front desk.</h2>
              <p className="lead">GymFlow is built around Naira billing, Paystack payments, branded member access and the workflows used to operate a gym.</p>
              <p>Owners can manage memberships and staff access, members can check in and book classes, and instructors can work from the same platform.</p>
              <p>Our focus is straightforward: reduce manual administration while keeping each gym&apos;s data and permissions properly scoped.</p>
            </div>
          </div>
        </section>

        <section className="blk" style={{ background: 'var(--gf-surface)', borderTop: '1px solid var(--gf-border)', borderBottom: '1px solid var(--gf-border)' }}>
          <div className="wrap">
            <div className="sec-head"><h2>What guides the product</h2><p>The principles behind the workflows we ship.</p></div>
            <div className="values">
              {VALUES.map((v) => (
                <div className="feat" key={v.title}>
                  <div className="feat-ic">{v.icon}</div>
                  <h3>{v.title}</h3>
                  <p>{v.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="blk">
          <div className="wrap">
            <div className="cta">
              <h2>See how GymFlow fits your operation.</h2>
              <p>Explore the product or get in touch with a question about your gym.</p>
              <div className="hero-cta" style={{ marginTop: 0 }}>
                <Link href="/features" className="gf-btn gf-btn-primary gf-btn-lg">Explore features</Link>
                <Link href="/contact" className="gf-btn gf-btn-outline gf-btn-lg">Get in touch</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}

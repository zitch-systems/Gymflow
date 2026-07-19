import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { Building2, Zap, Feather, ShieldCheck } from 'lucide-react';

export const metadata = {
  title: 'About',
  description: 'Built in Lagos, for the gyms that built us. GymFlow makes gym software that feels local.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About · GymFlow',
    description: 'Built in Lagos, for the gyms that built us. GymFlow makes gym software that feels local.',
    url: '/about',
    // Per-segment openGraph replaces (not merges) the root layout's — re-declare
    // the root OG image so it isn't dropped for this page.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About · GymFlow',
    description: 'Built in Lagos, for the gyms that built us. GymFlow makes gym software that feels local.',
    images: ['/images/og.png'],
  },
};

const KPIS = [
  { v: '140+', l: 'Gyms running on GymFlow' },
  { v: '96k', l: 'Members checked in monthly' },
  { v: '₦1.2b', l: 'Processed in subscriptions' },
  { v: '99.9%', l: 'Platform uptime' },
];

const VALUES = [
  { icon: <Zap strokeWidth={1.75} />, title: 'Local by default', body: 'Naira pricing, Paystack rails, WhatsApp reminders, lightweight on data. Built for how Nigerian gyms actually run.' },
  { icon: <Feather strokeWidth={1.75} />, title: 'Simple beats clever', body: 'A front-desk attendant should never need a manual. If a feature needs explaining, we redesign it.' },
  { icon: <ShieldCheck strokeWidth={1.75} />, title: 'Trust is the product', body: "Members' data and gym owners' money are sacred. Bank-grade isolation, transparent billing, no lock-in." },
];

const TEAM = [
  { name: 'Tobi Adeyemi', role: 'Co-founder · CEO', img: 'gym-studio' },
  { name: 'Amara Eze', role: 'Co-founder · Product', img: 'gym-machines' },
  { name: 'Seyi Bello', role: 'Co-founder · Engineering', img: 'gym-barbell' },
  { name: 'Halima Yusuf', role: 'Head of Customer Success', img: 'gym-kettlebells' },
];

export default function AboutPage() {
  return (
    <>
      <MarketingNav cur="about" />

      <main id="main-content">
      <header className="phero">
        <div className="wrap">
          <span className="eyebrow"><Building2 strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Our story</span>
          <h1>Built in Lagos, for the gyms that built us.</h1>
          <p>GymFlow began on a whiteboard in a Yaba co-working space — three friends frustrated that running a great gym meant drowning in spreadsheets, missed renewals and manual WhatsApp reminders.</p>
        </div>
      </header>

      <section className="blk">
        <div className="wrap split">
          <Image src="/images/gym-floor.jpg" alt="Gym floor" width={620} height={460} sizes="(max-width:860px) 100vw, 50vw" />
          <div>
            <h2>We make gym software that feels local.</h2>
            <p className="lead">Most gym platforms are built for studios in California and priced in dollars. We wanted something that understood Naira, Paystack, patchy networks and the realities of a Nigerian front desk.</p>
            <p>So we built GymFlow mobile-first and offline-tolerant, with subscriptions that auto-renew in Naira and reminders that go out on the channels members actually use. No hardware to buy, no FX surprises, live in an afternoon.</p>
            <p>Today GymFlow powers independent studios and multi-floor facilities across Lagos, Abuja and Port Harcourt — and we are just getting started.</p>
          </div>
        </div>
      </section>

      <section className="blk" style={{ background: 'var(--gf-surface)', borderTop: '1px solid var(--gf-border)', borderBottom: '1px solid var(--gf-border)' }}>
        <div className="wrap">
          <dl className="kpis">
            {KPIS.map((k) => (
              <div className="kpi" key={k.l}><dt>{k.v}</dt><dd>{k.l}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      <section className="blk">
        <div className="wrap">
          <div className="sec-head"><h2>What we believe</h2><p>The principles behind every decision we make.</p></div>
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

      <section className="blk" style={{ background: 'var(--gf-surface)', borderTop: '1px solid var(--gf-border)', borderBottom: '1px solid var(--gf-border)' }}>
        <div className="wrap">
          <div className="sec-head"><h2>The team</h2><p>A small crew of operators, engineers and designers.</p></div>
          <div className="team">
            {TEAM.map((m) => (
              <div className="member" key={m.name}>
                <div className="ph"><Image src={`/images/${m.img}.jpg`} alt="" width={240} height={240} sizes="(max-width:860px) 50vw, 240px" /></div>
                <strong>{m.name}</strong>
                <small>{m.role}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="blk">
        <div className="wrap">
          <div className="cta">
            <h2>Want to build the future of fitness with us?</h2>
            <p>We&apos;re hiring across engineering, design and customer success.</p>
            <div className="hero-cta" style={{ marginTop: 0 }}>
              <Link href="/careers" className="gf-btn gf-btn-primary gf-btn-lg">See open roles</Link>
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

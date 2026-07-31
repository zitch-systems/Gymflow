import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { HeroBackground3D } from '@/components/marketing/hero-background-3d';
import { LogoMark } from '@/components/ui/logo';
import {
  MapPin, ScanLine, CreditCard, CalendarDays, Users, BarChart3, Smartphone,
  Check, ShieldCheck, Mail, MessageCircle, Sparkles,
} from 'lucide-react';

export const metadata: Metadata = {
  // `title.absolute` opts this page out of the root layout's `%s · GymFlow`
  // template. This string already *is* the site default, so as a plain
  // string it would get templated too, rendering the tab title as
  // "GymFlow — Run your gym the modern way · GymFlow".
  title: { absolute: 'GymFlow — Run your gym the modern way' },
  description:
    'Check-ins, Paystack subscriptions, class booking and automated reminders — one mobile-first platform, light enough to fly on Nigerian networks.',
  alternates: { canonical: '/' },
  openGraph: {
    url: '/',
    title: 'GymFlow — Run your gym the modern way',
    description:
      'Check-ins, Paystack subscriptions, class booking and automated reminders — one mobile-first platform, light enough to fly on Nigerian networks.',
    // Per-segment openGraph/twitter objects replace (not deep-merge) the
    // root layout's — re-declare the root OG image so it isn't dropped.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GymFlow — Run your gym the modern way',
    description:
      'Check-ins, Paystack subscriptions, class booking and automated reminders — one mobile-first platform, light enough to fly on Nigerian networks.',
    images: ['/images/og.png'],
  },
};

// Marketing landing — recreates revamp/marketing.html in Next.js.
// Hero (photo-led), trust strip, features (6), how-it-works (3 steps),
// gallery (4 photos), pricing (3 tiers — Most popular middle), CTA and footer.
// Photo assets live in /public/images.
export default function MarketingHome() {
  return (
    <>
      <MarketingNav />

      <main id="main-content">
      {/* ── Hero ── */}
      <header className="hero">
        <div
          className="hero-bg"
          style={{ backgroundImage: 'url(/images/gym-action.jpg)' }}
          aria-hidden
        />
        <HeroBackground3D />
        <div className="wrap hero-in">
          <LogoMark size={132} className="logo-hero" />
          <span className="eyebrow">
            <MapPin strokeWidth={1.75} /> Made for Nigerian gyms
          </span>
          <h1>Run your gym the <span className="g">modern way</span>.</h1>
          <p className="sub">
            Check-ins, Paystack subscriptions, class booking and automated reminders — one mobile-first
            platform, light enough to fly on Nigerian networks.
          </p>
          <div className="hero-cta">
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
            <Link href="#features" className="gf-btn gf-btn-outline gf-btn-lg">Explore features</Link>
          </div>
          <dl className="hero-stats">
            <div className="s"><dt>Members</dt><dd><span className="u">Unlimited</span></dd></div>
            <div className="s"><dt>Locations</dt><dd>Multi-gym</dd></div>
            <div className="s"><dt>Billing</dt><dd>Naira</dd></div>
          </dl>
        </div>
      </header>

      {/* ── Trust strip ── */}
      <div className="strip">
        <div className="wrap strip-in">
          <span className="lbl">Works with the tools Nigerian gyms already use</span>
          <span className="chip2"><CreditCard strokeWidth={1.75} /> Paystack</span>
          <span className="chip2"><MessageCircle strokeWidth={1.75} /> WhatsApp</span>
          <span className="chip2"><Mail strokeWidth={1.75} /> Email receipts</span>
          <span className="chip2"><Smartphone strokeWidth={1.75} /> Installable PWA</span>
          <span className="chip2"><ShieldCheck strokeWidth={1.75} /> Tenant-scoped access</span>
        </div>
      </div>

      {/* ── Showcase ── */}
      <section className="blk showcase">
        <div className="wrap show-grid">
          <div className="show-media">
            <Image src="/images/gym-athlete.jpg" alt="Athlete training at the gym" width={720} height={900} sizes="(max-width:900px) 100vw, 50vw" className="show-img" priority={false} />
            <div className="show-badge"><ScanLine strokeWidth={1.9} /> <span>Checked in · 7:02 AM</span></div>
          </div>
          <div className="show-copy">
            <span className="eyebrow"><Sparkles strokeWidth={1.75} /> Built for the floor</span>
            <h2>Run the front desk from your pocket</h2>
            <p>Members scan in at the door, book the 6 AM class, and renew with Paystack — while you watch attendance and revenue update live. No spreadsheets, no WhatsApp back-and-forth.</p>
            <ul className="show-list">
              <li><Check strokeWidth={2.4} /> Fast QR check-in at the door</li>
              <li><Check strokeWidth={2.4} /> Auto-renewing Naira subscriptions</li>
              <li><Check strokeWidth={2.4} /> Class booking with caps &amp; waitlists</li>
              <li><Check strokeWidth={2.4} /> Live revenue, churn &amp; attendance</li>
            </ul>
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="blk" id="features">
        <div className="wrap">
          <div className="sec-head">
            <h2>Everything your gym needs</h2>
            <p>From the front desk to the back office, GymFlow covers the day-to-day.</p>
          </div>
          <div className="feat-grid">
            <Feature icon={<ScanLine strokeWidth={1.75} />} title="QR check-in" body="Members scan a code and staff see attendance update live." />
            <Feature icon={<CreditCard strokeWidth={1.75} />} title="Paystack subscriptions" body="Auto-renew, dunning, and saved cards — in Naira, no FX." />
            <Feature icon={<CalendarDays strokeWidth={1.75} />} title="Class scheduling" body="Recurring classes, booking caps, waitlists, RSVP reminders." />
            <Feature icon={<Users strokeWidth={1.75} />} title="Staff & roles" body="Owner, manager, front desk, accountant, instructor — each sees what they need." />
            <Feature icon={<BarChart3 strokeWidth={1.75} />} title="Live analytics" body="Revenue, churn, attendance — daily, monthly, exportable." />
            <Feature icon={<Smartphone strokeWidth={1.75} />} title="Installs anywhere" body="Add to home screen on Android & iOS. Push notifications optional." />
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section
        className="blk"
        id="how"
        style={{
          background: 'var(--gf-surface)',
          borderTop: '1px solid var(--gf-border)',
          borderBottom: '1px solid var(--gf-border)',
        }}
      >
        <div className="wrap">
          <div className="sec-head">
            <h2>Get started in three steps</h2>
            <p>No installs, no hardware. Three steps from signup to your first check-in.</p>
          </div>
          <div className="steps">
            <Step n={1} title="Create your gym" body="Sign up and get a branded subdomain, admin login, and default pricing plans provisioned instantly." />
            <Step n={2} title="Print your QR" body="Download your static check-in QR from settings and post it at the entrance. Members scan to check in." />
            <Step n={3} title="Grow on autopilot" body="Paystack auto-renews subscriptions, reminders go out on WhatsApp & email, and analytics update live." />
          </div>
        </div>
      </section>

      {/* ── Gallery ── */}
      <section className="blk">
        <div className="wrap">
          <div className="sec-head">
            <h2>Made for real gyms</h2>
            <p>From boutique studios to multi-floor facilities.</p>
          </div>
          <div className="gal">
            {(['gym-bikes', 'gym-machines', 'gym-kettlebells', 'gym-barbell'] as const).map((slug) => (
              <div key={slug}>
                <Image src={`/images/${slug}.jpg`} alt={altFor(slug)} width={400} height={533} sizes="(max-width:1100px) 50vw, 280px" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section
        className="blk"
        id="pricing"
        style={{
          background: 'var(--gf-surface)',
          borderTop: '1px solid var(--gf-border)',
          borderBottom: '1px solid var(--gf-border)',
        }}
      >
        <div className="wrap">
          <div className="sec-head">
            <h2>Simple, Naira pricing</h2>
            <p>Cancel anytime. No setup fees. Every plan includes unlimited members.</p>
          </div>
          <div className="price-grid">
            <PricingTier
              name="Starter"
              amount="₦13,999"
              period="/mo"
              tagline="For single-location studios"
              features={['Unlimited members', 'QR check-in', 'Paystack subscriptions', 'Email reminders']}
              cta="Choose Starter"
              variant="secondary"
            />
            <PricingTier
              name="Growth"
              amount="₦37,999"
              period="/mo"
              tagline="For growing gyms & classes"
              features={['Everything in Starter', 'Class scheduling + waitlists', 'WhatsApp reminders', 'Live analytics + exports']}
              cta="Choose Growth"
              variant="primary"
              popular
            />
            <PricingTier
              name="Scale"
              amount="₦119,999"
              period="/mo"
              tagline="For multi-location operators"
              features={['Everything in Growth', 'Multi-gym & staff roles', 'Instructor payouts', 'Priority support']}
              cta="Choose Scale"
              variant="secondary"
            />
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="blk">
        <div className="wrap">
          <div className="cta">
            <h2>Ready to run your gym the modern way?</h2>
            <p>Start with clear monthly pricing. From ₦13,999/mo · cancel anytime · no setup fees.</p>
            <div className="hero-cta" style={{ marginTop: 0 }}>
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
              <Link href="#pricing" className="gf-btn gf-btn-outline gf-btn-lg">See pricing</Link>
            </div>
          </div>
        </div>
      </section>
      </main>

      <MarketingFooter />
    </>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="feat">
      <div className="feat-ic">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="step">
      <div className="n">{n}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function PricingTier({
  name, amount, period, tagline, features, cta, variant, popular,
}: {
  name: string; amount: string; period: string; tagline: string; features: string[];
  cta: string; variant: 'primary' | 'secondary'; popular?: boolean;
}) {
  return (
    <div className={`price${popular ? ' pop' : ''}`}>
      <div className="pname">{name}</div>
      <div className="amt">{amount}<small>{period}</small></div>
      <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>{tagline}</div>
      <ul>
        {features.map((f) => (
          <li key={f}><Check strokeWidth={2.2} /> {f}</li>
        ))}
      </ul>
      <Link href="/signup" className={`gf-btn gf-btn-${variant} gf-btn-full`} style={{ marginTop: 'auto' }}>
        {cta}
      </Link>
    </div>
  );
}

function altFor(slug: 'gym-bikes' | 'gym-machines' | 'gym-kettlebells' | 'gym-barbell'): string {
  return { 'gym-bikes': 'Air bikes', 'gym-machines': 'Machines', 'gym-kettlebells': 'Kettlebells', 'gym-barbell': 'Barbell' }[slug];
}

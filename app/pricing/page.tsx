import Link from 'next/link';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { Check, Wallet } from 'lucide-react';
import {
  PLATFORM_PLANS, PLAN_TIERS, BILLING_CYCLES, CYCLE_LABEL, CYCLE_SUFFIX,
  DEFAULT_CYCLE, planPrice, monthlyEquivalentKobo, cycleSavingPct,
} from '@/lib/platform-plans';
import { BreadcrumbLd } from '@/components/marketing/breadcrumb-ld';

export const metadata = {
  title: 'Pricing',
  description: 'Simple, Naira pricing. Cancel anytime, no setup fees, unlimited members on every plan.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing · GymFlow',
    description: 'Simple, Naira pricing. Cancel anytime, no setup fees, unlimited members on every plan.',
    url: '/pricing',
    // Per-segment openGraph replaces (not merges) the root layout's — re-declare
    // the root OG image so it isn't dropped for this page.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pricing · GymFlow',
    description: 'Simple, Naira pricing. Cancel anytime, no setup fees, unlimited members on every plan.',
    images: ['/images/og.png'],
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

// Product + per-tier Offer structured data, generated from the real plan
// catalog (lib/platform-plans.ts — amounts in kobo, Paystack is the source of
// truth) so this can never drift from the displayed/charged prices below.
const PRICING_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'GymFlow',
  description: 'Gym management software for Nigerian gyms — check-ins, Paystack subscriptions, class booking and automated reminders.',
  image: `${SITE_URL}/images/og.png`,
  url: `${SITE_URL}/pricing`,
  brand: { '@type': 'Brand', name: 'GymFlow' },
  // One Offer per tier × billing cycle — the same four Paystack Plans that can
  // actually be bought.
  offers: PLAN_TIERS.flatMap((tier) => {
    const plan = PLATFORM_PLANS[tier];
    return BILLING_CYCLES.map((cycle) => ({
      '@type': 'Offer',
      name: `${plan.name} · ${CYCLE_LABEL[cycle]}`,
      price: planPrice(tier, cycle).amountKobo / 100,
      priceCurrency: 'NGN',
      description: `${plan.tagline}. Billed ${cycle} in Naira, cancel anytime.`,
      url: `${SITE_URL}/pricing`,
      availability: 'https://schema.org/InStock',
    }));
  }),
});
// Note: unlike app/g/[slug]/page.tsx's gymLd (built from gym-owner-submitted
// fields), every value here comes from the PLATFORM_PLANS constant in
// lib/platform-plans.ts — developer-authored, not user input — so there's no
// "</script>"-breakout risk to defend against and no '<' escaping is needed.

// Display-only per-tier extras (feature bullets, CTA emphasis). Name, price
// and tagline come from PLATFORM_PLANS so the cards, the JSON-LD Offers and
// the charged Paystack amount can never drift apart.
const TIER_DISPLAY: Record<(typeof PLAN_TIERS)[number], { features: string[]; popular?: boolean; variant: 'primary' | 'secondary' }> = {
  starter: {
    features: ['Unlimited members', 'QR check-in', 'Paystack subscriptions', 'Email reminders'],
    variant: 'secondary',
  },
  growth: {
    features: [
      'Everything in Starter', 'Class scheduling + waitlists', 'WhatsApp reminders',
      'Live analytics + exports', 'Multi-gym & staff roles', 'Instructor payouts', 'Priority support',
    ],
    popular: true, variant: 'primary',
  },
};

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

// The card headlines the quarterly price (the shortest commitment GymFlow sells)
// and names the annual one underneath, so both buyable cycles are on the page
// without a client-side toggle.
const ALT_CYCLE = BILLING_CYCLES.find((c) => c !== DEFAULT_CYCLE)!;

const TIERS = PLAN_TIERS.map((tier) => {
  const plan = PLATFORM_PLANS[tier];
  const d = TIER_DISPLAY[tier];
  const save = cycleSavingPct(tier, ALT_CYCLE);
  return {
    name: plan.name,
    amount: naira(planPrice(tier, DEFAULT_CYCLE).amountKobo),
    period: CYCLE_SUFFIX[DEFAULT_CYCLE],
    monthly: `≈${naira(monthlyEquivalentKobo(tier, DEFAULT_CYCLE))}/mo`,
    alt: `or ${naira(planPrice(tier, ALT_CYCLE).amountKobo)}${CYCLE_SUFFIX[ALT_CYCLE]}${save > 0 ? ` — save ${save}%` : ''}`,
    tagline: plan.tagline,
    features: d.features,
    popular: d.popular,
    variant: d.variant,
    cta: `Choose ${plan.name}`,
  };
});

// Visible FAQ content + matching FAQPage JSON-LD (Google requires the Q&A to
// be rendered on the page for FAQ rich results — both come from this one
// constant so they can't diverge).
const FAQS = [
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Plans are billed quarterly or annually through Paystack with no long-term contract — cancel from Billing and your access runs to the end of the period you have already paid for.',
  },
  {
    q: 'What is the difference between quarterly and annual?',
    a: 'Only the billing cycle and the price. Quarterly is the shortest commitment we sell and is charged every three months; annual is charged once a year and works out about 20% cheaper per month. Both include exactly the same features.',
  },
  {
    q: 'Do you charge per member?',
    a: 'No. Every plan includes unlimited members; the price only changes with the feature tier you pick.',
  },
  {
    q: 'How do my members pay?',
    a: 'Members pay by card, bank transfer or USSD through Paystack, and the money settles straight to your gym’s own bank account via your Paystack subaccount.',
  },
  {
    q: 'Are there setup fees?',
    a: 'None. You can create your gym, get a branded subdomain and configure member check-in without a setup charge.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Yes — change tier or billing cycle from Billing at any time; the new plan applies from your next billing cycle.',
  },
];

const FAQ_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});

export default function PricingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: PRICING_LD }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_LD }} />
      <BreadcrumbLd name="Pricing" path="/pricing" />
      <MarketingNav cur="pricing" />

      <main id="main-content">
      <header className="phero">
        <div className="wrap">
          <span className="eyebrow"><Wallet strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Pricing</span>
          <h1>Simple, Naira pricing.</h1>
          <p>Cancel anytime. No setup fees. Every plan includes unlimited members.</p>
        </div>
      </header>

      <section className="blk">
        <div className="wrap">
          <div className="price-grid">
            {TIERS.map((t) => (
              <div className={`price${t.popular ? ' pop' : ''}`} key={t.name}>
                <div className="pname">{t.name}</div>
                <div className="amt">{t.amount}<small>{t.period}</small></div>
                <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>{t.monthly} · {t.tagline}</div>
                <div style={{ color: 'var(--gf-brand)', fontSize: '0.8rem', fontWeight: 600 }}>{t.alt}</div>
                <ul>
                  {t.features.map((f) => (
                    <li key={f}><Check strokeWidth={2.2} /> {f}</li>
                  ))}
                </ul>
                <Link href="/signup" className={`gf-btn gf-btn-${t.variant} gf-btn-full`} style={{ marginTop: 'auto' }}>
                  {t.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="blk" style={{ paddingTop: 0 }} aria-labelledby="pricing-faq-h">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <h2 id="pricing-faq-h" style={{ textAlign: 'center', marginBottom: 24 }}>Pricing questions</h2>
          {FAQS.map((f) => (
            <details key={f.q} style={{ borderBottom: '1px solid var(--gf-border)', padding: '14px 4px' }}>
              <summary style={{ cursor: 'pointer', fontFamily: 'var(--gf-font-display)', fontWeight: 700 }}>{f.q}</summary>
              <p style={{ margin: '10px 0 4px', color: 'var(--gf-text-secondary)', lineHeight: 1.55 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="cta">
            <h2>Ready to run your gym the modern way?</h2>
            <p>Two plans, billed quarterly or annually · cancel anytime · no setup fees.</p>
            <div className="hero-cta" style={{ marginTop: 0 }}>
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
              <Link href="/features" className="gf-btn gf-btn-outline gf-btn-lg">Explore features</Link>
            </div>
          </div>
        </div>
      </section>

      </main>

      <MarketingFooter />
    </>
  );
}

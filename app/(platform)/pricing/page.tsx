import Link from 'next/link';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { Faq } from '@/components/marketing/sections';
import { PLATFORM_PRICING, BILLING_PERIODS, periodSavings, formatNaira } from '@/lib/platform-pricing';
import { Check } from 'lucide-react';

export { pricingMetadata as metadata } from './metadata';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

const PRICING_LD = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'GymFlow',
  description: 'Multi-tenant gym management SaaS for Nigerian fitness businesses.',
  brand: { '@type': 'Brand', name: 'GymFlow' },
  offers: BILLING_PERIODS.map((p) => ({
    '@type': 'Offer',
    name: PLATFORM_PRICING[p].label,
    price: String(PLATFORM_PRICING[p].amount),
    priceCurrency: 'NGN',
    url: `${SITE}/pricing`,
    availability: 'https://schema.org/InStock',
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: String(PLATFORM_PRICING[p].amount),
      priceCurrency: 'NGN',
      unitText: PLATFORM_PRICING[p].per,
    },
  })),
};

const INCLUDED = [
  'Unlimited members & staff',
  'Paystack payments & auto-debit',
  'QR check-in & attendance',
  'Classes, booking & waitlists',
  'Instructor portal & payouts',
  'Analytics, P&L & exports',
  'WhatsApp & email reminders',
  'Multi-location ready',
  'Daily backups',
];

export default function PricingPage() {
  return (
    <div className="marketing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PRICING_LD) }}
      />
      <MarketingNav />

      <main id="main-content" tabIndex={-1}>
      <header className="marketing-hero mk-subhero">
        <div className="container">
          <span className="marketing-eyebrow">Pricing</span>
          <h1 className="marketing-hero-title">Simple Naira pricing</h1>
          <p className="marketing-hero-sub">No per-member fees. Every plan includes everything — pick the billing cycle that suits you.</p>
        </div>
      </header>

      <section className="marketing-section" style={{ paddingTop: 8 }}>
        <div className="container">
          <div className="mk-price-grid">
            {BILLING_PERIODS.map((b) => {
              const p = PLATFORM_PRICING[b];
              const savings = periodSavings(b);
              const monthly = p.months > 1 ? Math.round(p.amount / p.months) : null;
              const best = b === 'annual';
              return (
                <article key={b} className={`mk-price-card${best ? ' best' : ''}`}>
                  {best && <span className="mk-price-badge">Best value</span>}
                  <h3 className="mk-price-name">{p.label}</h3>
                  <div className="mk-price-amount">{formatNaira(p.amount)}<span>/{p.per}</span></div>
                  <p className="mk-price-note">
                    {monthly ? `≈ ${formatNaira(monthly)}/mo` : 'Billed monthly'}
                    {savings > 0 ? ` · save ${formatNaira(savings)}` : ''}
                  </p>
                  <Link href="/signup" className={`gf-btn gf-btn-full ${best ? 'gf-btn-primary' : 'gf-btn-secondary'}`}>
                    Launch your gym
                  </Link>
                  <ul className="mk-price-list">
                    {INCLUDED.map((i) => <li key={i}><Check size={15} strokeWidth={2.5} /> {i}</li>)}
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="mk-price-foot">Cancel anytime · no setup fees · no per-member fees. Paystack transaction fees apply per payment.</p>
        </div>
      </section>

      <section id="faq" className="marketing-section mk-faq-section">
        <div className="container">
          <h2 className="marketing-section-title">Questions, answered</h2>
          <p className="marketing-section-sub">Everything you need to know before you start.</p>
          <div className="mk-faq">
            <Faq q="Do my members need to download an app?" a="No. GymFlow is a PWA — members open your gym's link in any browser and can optionally add it to their home screen. It works on Android and iOS, even on slow connections." />
            <Faq q="How do payments work?" a="Members pay in Naira via Paystack (card or bank transfer). Cards are tokenised so renewals happen automatically. Funds settle into your gym's own Paystack subaccount — we never hold your money." />
            <Faq q="Is there a per-member fee?" a="No. Your GymFlow plan covers unlimited members and staff. The only other cost is Paystack's standard transaction fee, paid by you or passed to members." />
            <Faq q="Can I run more than one location?" a="Yes. Owners and managers can belong to multiple gyms with a single login, and each location gets its own branded subdomain and isolated data." />
            <Faq q="Can I change or cancel my plan?" a="Anytime. Switch between monthly, quarterly and annual, or cancel — there are no setup fees or lock-in contracts." />
            <Faq q="What about my members' data?" a="Every gym's data is isolated at the database level with row-level security. No gym can ever see another gym's members, payments, or check-ins." />
          </div>
        </div>
      </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

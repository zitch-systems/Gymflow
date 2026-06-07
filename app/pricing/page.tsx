import Link from 'next/link';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { Check, Wallet } from 'lucide-react';

export const metadata = {
  title: 'Pricing',
  description: 'Simple, Naira pricing. Cancel anytime, no setup fees, unlimited members on every plan.',
};

const TIERS = [
  {
    name: 'Starter', amount: '₦13,999', period: '/mo', tagline: 'For single-location studios',
    features: ['Unlimited members', 'QR check-in', 'Paystack subscriptions', 'Email reminders'],
    cta: 'Choose Starter', variant: 'secondary' as const,
  },
  {
    name: 'Growth', amount: '₦37,999', period: '/mo', tagline: 'For growing gyms & classes', popular: true,
    features: ['Everything in Starter', 'Class scheduling + waitlists', 'WhatsApp reminders', 'Live analytics + exports'],
    cta: 'Choose Growth', variant: 'primary' as const,
  },
  {
    name: 'Scale', amount: '₦119,999', period: '/mo', tagline: 'For multi-location operators',
    features: ['Everything in Growth', 'Multi-gym & staff roles', 'Instructor payouts', 'Priority support'],
    cta: 'Choose Scale', variant: 'secondary' as const,
  },
];

export default function PricingPage() {
  return (
    <>
      <MarketingNav cur="pricing" />

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
                <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>{t.tagline}</div>
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

      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="cta">
            <h2>Ready to run your gym the modern way?</h2>
            <p>Launch your gym in an afternoon. From ₦13,999/mo · cancel anytime · no setup fees.</p>
            <div className="hero-cta" style={{ marginTop: 0 }}>
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
              <Link href="/features" className="gf-btn gf-btn-outline gf-btn-lg">Explore features</Link>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  );
}

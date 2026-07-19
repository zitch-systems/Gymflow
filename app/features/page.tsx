import Link from 'next/link';
import Image from 'next/image';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import {
  Sparkles, ScanLine, UserSearch, BellRing, Repeat, Receipt, Banknote,
  CalendarDays, Hourglass, MessageCircle, Users, BarChart3, Smartphone,
} from 'lucide-react';

export const metadata = {
  title: 'Features',
  description: 'Everything to run a modern gym — members, payments, classes and operations in one mobile-first platform.',
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'Features · GymFlow',
    description: 'Everything to run a modern gym — members, payments, classes and operations in one mobile-first platform.',
    url: '/features',
    // Per-segment openGraph replaces (not merges) the root layout's — re-declare
    // the root OG image so it isn't dropped for this page.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Features · GymFlow',
    description: 'Everything to run a modern gym — members, payments, classes and operations in one mobile-first platform.',
    images: ['/images/og.png'],
  },
};

type Item = { icon: React.ReactNode; title: string; body: string };
type Cat = { tag: string; h2: string; lede: string; img: string; items: Item[] };

const CATS: Cat[] = [
  {
    tag: 'Members & check-in',
    h2: "Know who's in, who's lapsing",
    lede: 'QR check-in at the door, a live attendance feed, and a member list that surfaces who needs attention before they churn.',
    img: 'gym-floor',
    items: [
      { icon: <ScanLine strokeWidth={1.75} />, title: 'QR self check-in', body: 'Members scan at the entrance — works offline, syncs when back online.' },
      { icon: <UserSearch strokeWidth={1.75} />, title: 'Smart member list', body: 'Filter by status, search instantly, open a full profile in one tap.' },
      { icon: <BellRing strokeWidth={1.75} />, title: 'Lapse alerts', body: 'See expiring memberships and nudge them on WhatsApp before they go.' },
    ],
  },
  {
    tag: 'Payments',
    h2: 'Renewals that just happen',
    lede: 'Recurring billing in Naira with saved cards, auto-debit and dunning — so renewals just happen and you stop chasing.',
    img: 'gym-machines',
    items: [
      { icon: <Repeat strokeWidth={1.75} />, title: 'Auto-renew & auto-debit', body: 'Cards are charged on schedule; failed charges retry automatically.' },
      { icon: <Receipt strokeWidth={1.75} />, title: 'Instant receipts', body: 'Every successful charge emails a branded receipt to the member.' },
      { icon: <Banknote strokeWidth={1.75} />, title: 'No FX, no surprises', body: 'Priced and settled in Naira through Paystack you already trust.' },
    ],
  },
  {
    tag: 'Classes',
    h2: 'Schedule, book, fill every session',
    lede: 'Recurring classes with capacity caps, waitlists and RSVP reminders that keep your studios full and your coaches busy.',
    img: 'gym-bikes',
    items: [
      { icon: <CalendarDays strokeWidth={1.75} />, title: 'Recurring schedule', body: 'Set a class once; it repeats weekly with per-session capacity.' },
      { icon: <Hourglass strokeWidth={1.75} />, title: 'Waitlists', body: 'When a class fills, the next member is promoted automatically.' },
      { icon: <MessageCircle strokeWidth={1.75} />, title: 'RSVP reminders', body: 'A push and WhatsApp nudge an hour before each booked class.' },
    ],
  },
  {
    tag: 'Operations & insight',
    h2: 'Run the back office from your phone',
    lede: 'Staff roles, instructor payouts, business hours, analytics and exports — the whole operation, installable as an app.',
    img: 'gym-studio',
    items: [
      { icon: <Users strokeWidth={1.75} />, title: 'Staff & roles', body: 'Owner, manager, front desk, accountant, instructor — scoped access.' },
      { icon: <BarChart3 strokeWidth={1.75} />, title: 'Live analytics', body: 'Revenue, churn, attendance and growth — daily, monthly, exportable.' },
      { icon: <Smartphone strokeWidth={1.75} />, title: 'Installable PWA', body: 'Add to home screen on Android & iOS — no hardware to buy.' },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <MarketingNav cur="features" />

      <main id="main-content">
      <header className="head">
        <div className="wrap">
          <span className="eyebrow"><Sparkles strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Built for the day-to-day</span>
          <h1>Everything to run a <span>modern gym</span></h1>
          <p>From the front desk to the back office — members, payments, classes and operations in one mobile-first platform.</p>
        </div>
      </header>

      {CATS.map((c) => (
        <section className="cat" key={c.tag}>
          <div className="wrap cat-grid">
            <div className="cat-copy">
              <div className="tag">{c.tag}</div>
              <h2>{c.h2}</h2>
              <p>{c.lede}</p>
              <div className="flist">
                {c.items.map((it) => (
                  <div className="fitem" key={it.title}>
                    <div className="ic">{it.icon}</div>
                    <div>
                      <strong>{it.title}</strong>
                      <small>{it.body}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="cat-vis">
              <Image src={`/images/${c.img}.jpg`} alt="" fill sizes="(max-width:860px) 100vw, 55vw" style={{ objectFit: 'cover', opacity: 0.9 }} />
              <div className="scrim" />
            </div>
          </div>
        </section>
      ))}

      <div className="wrap">
        <div className="cta">
          <h2>Ready to run your gym the modern way?</h2>
          <p>Launch in an afternoon. From ₦13,999/mo · cancel anytime.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
            <Link href="/pricing" className="gf-btn gf-btn-outline gf-btn-lg">See pricing</Link>
          </div>
        </div>
      </div>

      </main>

      <MarketingFooter />
    </>
  );
}

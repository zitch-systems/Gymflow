import Link from 'next/link';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { FeatureCard } from '@/components/marketing/sections';
import {
  ScanLine, CreditCard, CalendarDays, Users, BarChart3, Smartphone,
  Bell, Wallet, Wrench, FileText, GraduationCap, ClipboardList, Check,
} from 'lucide-react';

export const metadata = {
  title: 'Features',
  description: 'Check-in, Paystack subscriptions, classes, staff, analytics, and automation — everything a Nigerian gym needs.',
};

function FeatureRow({
  eyebrow, title, body, points, img, alt, reverse,
}: { eyebrow: string; title: string; body: string; points: string[]; img: string; alt: string; reverse?: boolean }) {
  return (
    <div className={`mk-feature-row${reverse ? ' reverse' : ''}`}>
      <div className="mk-feature-row-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={alt} loading="lazy" />
      </div>
      <div className="mk-feature-row-copy">
        <span className="marketing-eyebrow">{eyebrow}</span>
        <h2 className="marketing-section-title" style={{ textAlign: 'left' }}>{title}</h2>
        <p className="marketing-section-sub" style={{ textAlign: 'left', margin: '12px 0 18px' }}>{body}</p>
        <ul className="mk-checklist">
          {points.map((p) => <li key={p}><Check size={16} strokeWidth={2.5} /> {p}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <div className="marketing">
      <MarketingNav />

      <header className="marketing-hero mk-subhero">
        <div className="container">
          <span className="marketing-eyebrow">Features</span>
          <h1 className="marketing-hero-title">Everything to run and grow your gym</h1>
          <p className="marketing-hero-sub">One platform for members, payments, classes, staff, and the back office — built mobile-first for Nigeria.</p>
          <div className="marketing-hero-actions">
            <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
            <Link href="/pricing" className="gf-btn gf-btn-outline gf-btn-lg">See pricing</Link>
          </div>
        </div>
      </header>

      <section className="marketing-section">
        <div className="container">
          <div className="marketing-grid">
            <FeatureCard icon={ScanLine} title="QR check-in" body="Members scan a static entrance code from the PWA. Attendance logs live; works offline." />
            <FeatureCard icon={CreditCard} title="Paystack subscriptions" body="Card & transfer in Naira, tokenised cards, auto-renew with smart retries." />
            <FeatureCard icon={CalendarDays} title="Classes & booking" body="Recurring timetable, capacity caps, waitlists with auto-promotion." />
            <FeatureCard icon={Users} title="Staff & roles" body="Owner, manager, front desk, accountant, instructor — scoped access for each." />
            <FeatureCard icon={GraduationCap} title="Instructor portal" body="Coaches manage clients, sessions, earnings and payouts from their phone." />
            <FeatureCard icon={BarChart3} title="Analytics & reports" body="Revenue, churn, attendance, P&L — live, with CSV/PDF export." />
            <FeatureCard icon={Bell} title="Automated reminders" body="Expiry nudges at 7/3/1 days on WhatsApp + email. Receipts on every payment." />
            <FeatureCard icon={Wallet} title="Wallet & payments" body="Real-time balance, full transaction history, manual cash entry." />
            <FeatureCard icon={Wrench} title="Equipment & expenses" body="Track inventory, maintenance schedules, and a daily expense ledger." />
            <FeatureCard icon={FileText} title="Digital waiver" body="Versioned waiver with timestamped signatures captured at signup." />
            <FeatureCard icon={Smartphone} title="Installable PWA" body="Branded member & coach apps — add to home screen on Android & iOS." />
            <FeatureCard icon={ClipboardList} title="Self-service onboarding" body="Members sign up, pay, and get a membership in minutes — no front-desk queue." />
          </div>
        </div>
      </section>

      <section className="marketing-section mk-rows">
        <div className="container">
          <FeatureRow
            eyebrow="For members"
            title="A branded app your members actually use"
            body="Members check in by QR, see days remaining, renew in a tap, browse classes, and book a spot — all from a fast PWA that installs to their home screen."
            points={['QR check-in with instant access feedback', 'Renew & pay ahead via Paystack', 'Book classes with live capacity & waitlists', 'Streaks, activity, and next-class at a glance']}
            img="/images/gym-studio.jpg" alt="Cardio studio"
          />
          <FeatureRow
            reverse
            eyebrow="For owners"
            title="The back office, on autopilot"
            body="Auto-debit renewals, dunning, expiry reminders, and live analytics mean less admin and more retained members — money settles straight to your Paystack subaccount."
            points={['Auto-debit with retries & grace periods', 'Expiry reminders on WhatsApp + email', 'Revenue, churn & attendance dashboards', 'Equipment, expenses, P&L and exports']}
            img="/images/gym-floor.jpg" alt="Gym floor with machines"
          />
          <FeatureRow
            eyebrow="For coaches"
            title="A portal built for instructors"
            body="Coaches manage their clients, schedule and mark sessions, track earnings with revenue share, and request payouts — capped to what they've actually earned."
            points={['Client list & session attendance', 'Class timetable & bookings', 'Earnings with revenue-share tracking', 'Self-service payout requests']}
            img="/images/gym-dumbbells.jpg" alt="Dumbbell rack"
          />
        </div>
      </section>

      <section className="marketing-section">
        <div className="container">
          <div className="mk-cta">
            <h2 className="mk-cta-title">See it running for your gym</h2>
            <p className="mk-cta-sub">Spin up your branded instance in minutes.</p>
            <div className="marketing-hero-actions" style={{ justifyContent: 'center' }}>
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">Launch your gym</Link>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

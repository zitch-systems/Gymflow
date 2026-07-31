import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav, MarketingFooter } from "@/components/marketing/chrome";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CircleDollarSign,
  CreditCard,
  MapPin,
  MessageCircle,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  Wifi,
} from "lucide-react";
import "./marketing-home.css";

export const metadata: Metadata = {
  title: { absolute: "GymFlow — Gym management built for Nigeria" },
  description:
    "Run memberships, Paystack payments, QR check-ins, classes, staff and reporting from one fast, mobile-first gym management platform.",
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: "GymFlow — Gym management built for Nigeria",
    description:
      "Run memberships, Paystack payments, QR check-ins, classes, staff and reporting from one fast, mobile-first platform.",
    images: [
      { url: "/images/og.png", width: 1200, height: 630, alt: "GymFlow" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "GymFlow — Gym management built for Nigeria",
    description:
      "Run memberships, Paystack payments, QR check-ins, classes, staff and reporting from one fast, mobile-first platform.",
    images: ["/images/og.png"],
  },
};

export default function MarketingHome() {
  return (
    <>
      <MarketingNav />

      <main id="main-content" className="marketing-home">
        <header className="hero home-hero">
          <div className="home-hero-glow" aria-hidden="true" />
          <div className="wrap hero-in home-hero-grid">
            <div className="home-hero-copy">
              <span className="eyebrow">
                <MapPin strokeWidth={1.8} /> Built for Nigerian gym operators
              </span>
              <h1>
                Your entire gym.{" "}
                <span className="g">One operating system.</span>
              </h1>
              <p className="sub">
                Replace spreadsheets, paper registers and payment chasing with
                one clear view of members, revenue, check-ins, classes and
                staff.
              </p>
              <div className="hero-cta">
                <Link
                  href="/signup"
                  className="gf-btn gf-btn-primary gf-btn-lg"
                >
                  Start free <ArrowRight strokeWidth={1.8} />
                </Link>
                <Link href="#how" className="gf-btn gf-btn-outline gf-btn-lg">
                  See how it works
                </Link>
              </div>
              <ul className="home-hero-proof" aria-label="What is included">
                <li>
                  <Check strokeWidth={2.4} /> No setup fee
                </li>
                <li>
                  <Check strokeWidth={2.4} /> Unlimited members
                </li>
                <li>
                  <Check strokeWidth={2.4} /> Works on any phone
                </li>
              </ul>
            </div>

            <ProductPreview />
          </div>
        </header>

        <section
          className="home-trust"
          aria-label="GymFlow platform capabilities"
        >
          <div className="wrap home-trust-in">
            <span className="home-trust-label">
              Made for the way your gym already works
            </span>
            <span>
              <CreditCard strokeWidth={1.8} /> Paystack payments
            </span>
            <span>
              <MessageCircle strokeWidth={1.8} /> WhatsApp-ready
            </span>
            <span>
              <Wifi strokeWidth={1.8} /> Fast on mobile data
            </span>
            <span>
              <ShieldCheck strokeWidth={1.8} /> Role-based access
            </span>
          </div>
        </section>

        <section className="blk home-outcomes" id="features">
          <div className="wrap">
            <div className="sec-head home-sec-head">
              <span className="eyebrow">
                <Sparkles strokeWidth={1.8} /> Less admin. More growth.
              </span>
              <h2>Know exactly what is happening in your gym.</h2>
              <p>
                Every important workflow is connected, so your team moves faster
                and nothing falls through the cracks.
              </p>
            </div>
            <div className="outcome-grid">
              <Outcome
                icon={<ScanLine strokeWidth={1.8} />}
                kicker="Front desk"
                title="Move the queue in seconds"
                body="Members scan in with QR. Staff see access status immediately, even during a busy morning rush."
                metric="Live attendance"
                featured
              />
              <Outcome
                icon={<CircleDollarSign strokeWidth={1.8} />}
                kicker="Cashflow"
                title="Stop chasing renewals"
                body="Collect in Naira with Paystack, automate renewals and keep every receipt tied to the right member."
                metric="Clear payment history"
                featured
              />
              <Outcome
                icon={<CalendarDays strokeWidth={1.8} />}
                kicker="Classes"
                title="Fill every session"
                body="Publish schedules, cap spaces and manage waitlists from one timetable."
                metric="Bookings in two taps"
              />
              <Outcome
                icon={<Users strokeWidth={1.8} />}
                kicker="Team"
                title="Give staff the right access"
                body="Owners, managers, front desk, accountants and coaches each see only what they need."
                metric="Five staff roles"
              />
            </div>
          </div>
        </section>

        <section className="blk home-feature-band">
          <div className="wrap">
            <div className="sec-head home-sec-head">
              <span className="eyebrow">
                <BarChart3 strokeWidth={1.8} /> One source of truth
              </span>
              <h2>From the door to the back office.</h2>
              <p>
                Built to run the daily details and give owners a sharper view of
                performance.
              </p>
            </div>
            <div className="feat-grid home-feature-grid">
              <Feature
                icon={<ScanLine strokeWidth={1.8} />}
                title="QR check-in"
                body="Fast member access with a live front-desk view."
              />
              <Feature
                icon={<CreditCard strokeWidth={1.8} />}
                title="Naira billing"
                body="Recurring Paystack payments, dunning and receipts."
              />
              <Feature
                icon={<CalendarDays strokeWidth={1.8} />}
                title="Class booking"
                body="Schedules, capacity limits, waitlists and reminders."
              />
              <Feature
                icon={<Users strokeWidth={1.8} />}
                title="Members & staff"
                body="Profiles, plans, roles and activity in one place."
              />
              <Feature
                icon={<TrendingUp strokeWidth={1.8} />}
                title="Owner analytics"
                body="Revenue, churn and attendance without spreadsheet work."
              />
              <Feature
                icon={<Smartphone strokeWidth={1.8} />}
                title="Mobile-first PWA"
                body="Install on Android or iPhone; no app store required."
              />
            </div>
          </div>
        </section>

        <section className="blk home-how" id="how">
          <div className="wrap home-how-grid">
            <div className="home-how-copy">
              <span className="eyebrow">
                <Sparkles strokeWidth={1.8} /> Quick setup
              </span>
              <h2>Open today. Run better tomorrow.</h2>
              <p>
                GymFlow gives you the essentials immediately, then grows with
                your team and locations.
              </p>
              <Link href="/signup" className="gf-btn gf-btn-primary gf-btn-lg">
                Launch your gym <ArrowRight strokeWidth={1.8} />
              </Link>
            </div>
            <div className="steps home-steps">
              <Step
                n="01"
                title="Create your gym"
                body="Add your brand, location and membership plans."
              />
              <Step
                n="02"
                title="Invite your team"
                body="Give each staff member the right role and access."
              />
              <Step
                n="03"
                title="Go live"
                body="Share your join link, print your QR and start collecting payments."
              />
            </div>
          </div>
        </section>

        <section className="blk home-pricing" id="pricing">
          <div className="wrap">
            <div className="sec-head home-sec-head">
              <span className="eyebrow">
                <CreditCard strokeWidth={1.8} /> Straightforward pricing
              </span>
              <h2>Start lean. Upgrade when you grow.</h2>
              <p>
                No setup fees. Unlimited members on every plan. Cancel anytime.
              </p>
            </div>
            <div className="price-grid">
              <PricingTier
                name="Starter"
                amount="₦13,999"
                tagline="For single-location studios"
                features={[
                  "Unlimited members",
                  "QR check-in",
                  "Paystack subscriptions",
                  "Email reminders",
                ]}
                cta="Start with Starter"
                variant="secondary"
              />
              <PricingTier
                name="Growth"
                amount="₦37,999"
                tagline="For gyms running classes"
                features={[
                  "Everything in Starter",
                  "Classes + waitlists",
                  "WhatsApp reminders",
                  "Analytics + exports",
                ]}
                cta="Choose Growth"
                variant="primary"
                popular
              />
              <PricingTier
                name="Scale"
                amount="₦119,999"
                tagline="For multi-location operators"
                features={[
                  "Everything in Growth",
                  "Multiple locations",
                  "Instructor payouts",
                  "Priority support",
                ]}
                cta="Choose Scale"
                variant="secondary"
              />
            </div>
          </div>
        </section>

        <section className="blk home-final">
          <div className="wrap">
            <div className="cta home-final-card">
              <span className="eyebrow">
                <ShieldCheck strokeWidth={1.8} /> Ready when you are
              </span>
              <h2>Give your gym a calmer way to grow.</h2>
              <p>
                Set up your workspace, invite your team and run your first
                check-in from one mobile-first platform.
              </p>
              <div className="hero-cta">
                <Link
                  href="/signup"
                  className="gf-btn gf-btn-primary gf-btn-lg"
                >
                  Start free <ArrowRight strokeWidth={1.8} />
                </Link>
                <Link
                  href="/contact"
                  className="gf-btn gf-btn-outline gf-btn-lg"
                >
                  Talk to us
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}

function ProductPreview() {
  return (
    <div
      className="product-stage"
      aria-label="Illustrative GymFlow owner dashboard preview"
    >
      <div className="product-window">
        <div className="product-topbar">
          <div>
            <span className="product-mark">
              <ScanLine strokeWidth={2} />
            </span>
            <strong>Owner overview</strong>
          </div>
          <span className="product-live">
            <i /> Live
          </span>
        </div>
        <div className="product-body">
          <div className="product-heading">
            <div>
              <small>GOOD MORNING</small>
              <strong>Your gym at a glance</strong>
            </div>
            <span>Today</span>
          </div>
          <div className="product-kpis">
            <div>
              <span>Revenue</span>
              <strong>₦684k</strong>
              <small className="up">+12.4%</small>
            </div>
            <div>
              <span>Check-ins</span>
              <strong>128</strong>
              <small>today</small>
            </div>
            <div>
              <span>Active members</span>
              <strong>846</strong>
              <small className="up">+18</small>
            </div>
          </div>
          <div className="product-grid">
            <div className="product-chart">
              <div>
                <span>Attendance</span>
                <strong>This week</strong>
              </div>
              <div className="bars" aria-hidden="true">
                {[42, 68, 54, 82, 64, 91, 74].map((height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="chart-labels" aria-hidden="true">
                <span>M</span>
                <span>T</span>
                <span>W</span>
                <span>T</span>
                <span>F</span>
                <span>S</span>
                <span>S</span>
              </div>
            </div>
            <div className="product-activity">
              <div>
                <span>Live activity</span>
                <strong>View all</strong>
              </div>
              <Activity
                icon={<ScanLine />}
                title="Member checked in"
                meta="Ada · 2 min ago"
              />
              <Activity
                icon={<CreditCard />}
                title="Payment received"
                meta="₦25,000 · 8 min ago"
              />
              <Activity
                icon={<Users />}
                title="New member joined"
                meta="Tobi · 14 min ago"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="product-float product-float-checkin">
        <ScanLine />
        <span>
          <strong>Access approved</strong>
          <small>Front desk · just now</small>
        </span>
        <Check />
      </div>
      <div className="product-float product-float-payment">
        <CreditCard />
        <span>
          <strong>₦37,999 received</strong>
          <small>Growth subscription</small>
        </span>
      </div>
    </div>
  );
}

function Activity({
  icon,
  title,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
}) {
  return (
    <div className="activity-row">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
    </div>
  );
}

function Outcome({
  icon,
  kicker,
  title,
  body,
  metric,
  featured,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  body: string;
  metric: string;
  featured?: boolean;
}) {
  return (
    <article className={`outcome${featured ? " outcome-featured" : ""}`}>
      <div className="outcome-icon">{icon}</div>
      <span className="outcome-kicker">{kicker}</span>
      <h3>{title}</h3>
      <p>{body}</p>
      <span className="outcome-metric">
        <Check strokeWidth={2.4} /> {metric}
      </span>
    </article>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="feat">
      <div className="feat-ic">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <article className="step">
      <div className="n">{n}</div>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </article>

import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { Scale, Lock, FileText, ClipboardCheck, ShieldCheck, Info } from 'lucide-react';

export const metadata = {
  title: 'Legal',
  description: 'GymFlow privacy policy, terms of service, liability waiver template, and security overview.',
  alternates: { canonical: '/legal' },
  openGraph: {
    title: 'Legal · GymFlow',
    description: 'GymFlow privacy policy, terms of service, liability waiver template, and security overview.',
    url: '/legal',
    // Per-segment openGraph replaces (not merges) the root layout's — re-declare
    // the root OG image so it isn't dropped for this page.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Legal · GymFlow',
    description: 'GymFlow privacy policy, terms of service, liability waiver template, and security overview.',
    images: ['/images/og.png'],
  },
};

export default function LegalPage() {
  return (
    <>
      <MarketingNav />

      <main id="main-content">
      <header className="phero">
        <div className="wrap">
          <span className="eyebrow"><Scale strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Legal</span>
          <h1>Policies, plainly written.</h1>
        </div>
      </header>

      <section className="blk">
        <div className="wrap legal-layout">
          <nav className="legal-nav">
            <a href="#privacy" className="cur"><Lock strokeWidth={1.75} /> Privacy</a>
            <a href="#terms"><FileText strokeWidth={1.75} /> Terms of Service</a>
            <a href="#waiver"><ClipboardCheck strokeWidth={1.75} /> Liability Waiver</a>
            <a href="#security"><ShieldCheck strokeWidth={1.75} /> Security</a>
          </nav>

          <div className="prose">
            <section id="privacy">
              <h2><span className="badge-ic"><Lock strokeWidth={1.75} /></span> Privacy Policy</h2>
              <p className="upd">Last updated 1 June 2026</p>
              <p>GymFlow helps gyms run their business. To do that we process information about gym owners, their staff, and their members. This policy explains what we collect, why, and the choices you have.</p>
              <h3>What we collect</h3>
              <ul>
                <li><strong>Account data</strong> — names, emails, phone numbers and roles for the people who use GymFlow.</li>
                <li><strong>Membership data</strong> — plans, check-ins, bookings and attendance that a gym records about its members.</li>
                <li><strong>Payment data</strong> — handled by our payments partner. We store references and status, never full card numbers.</li>
                <li><strong>Usage data</strong> — basic logs that keep the service reliable and secure.</li>
              </ul>
              <h3>How we use it</h3>
              <p>To provide the service, process subscriptions, send reminders the gym has configured, and improve GymFlow. We do not sell personal data, ever.</p>
              <div className="callout"><Info strokeWidth={1.75} /><p>Each gym is the data controller for its members. GymFlow processes that data on the gym&apos;s behalf, under our agreement with them.</p></div>
              <h3>Your choices</h3>
              <p>Members can request a copy of their data or ask their gym to delete it. Gym owners can export or erase their workspace at any time from Settings.</p>
            </section>

            <section id="terms">
              <h2><span className="badge-ic"><FileText strokeWidth={1.75} /></span> Terms of Service</h2>
              <p className="upd">Last updated 1 June 2026</p>
              <p>These terms govern your use of GymFlow. By creating a workspace you agree to them on behalf of your business.</p>
              <h3>Your account</h3>
              <p>You&apos;re responsible for keeping your login secure and for everything done under your account. Tell us right away if you suspect unauthorised access.</p>
              <h3>Subscriptions &amp; billing</h3>
              <ul>
                <li>Plans are billed monthly in Naira and renew automatically until cancelled.</li>
                <li>You can change or cancel a plan at any time; changes take effect at the next cycle.</li>
                <li>Fees already paid are non-refundable except where required by law.</li>
              </ul>
              <h3>Acceptable use</h3>
              <p>Don&apos;t misuse the service — no unlawful activity, no attempts to break our security, no reselling without permission. We may suspend workspaces that put the platform or other customers at risk.</p>
            </section>

            <section id="waiver">
              <h2><span className="badge-ic"><ClipboardCheck strokeWidth={1.75} /></span> Liability Waiver</h2>
              <p className="upd">Sample template · gyms should adapt with their own counsel</p>
              <p>Many gyms ask members to accept a liability waiver before training. GymFlow can present this digitally at sign-up and store the acceptance. This is a sample template only.</p>
              <h3>Assumption of risk</h3>
              <p>The member acknowledges that physical exercise carries inherent risks, including injury, and chooses to participate voluntarily and at their own risk.</p>
              <h3>Health declaration</h3>
              <p>The member confirms they are in suitable health to exercise and will stop and seek help if they feel unwell. They will disclose relevant conditions to gym staff.</p>
              <h3>Release</h3>
              <p>To the extent permitted by law, the member releases the gym and its staff from liability for injury arising from ordinary use of the facilities, except in cases of gross negligence.</p>
            </section>

            <section id="security">
              <h2><span className="badge-ic"><ShieldCheck strokeWidth={1.75} /></span> Security</h2>
              <p className="upd">Last updated 1 June 2026</p>
              <p>Security is the product. Gym owners trust us with their members&apos; data and their revenue, and we take that seriously.</p>
              <h3>How we protect data</h3>
              <ul>
                <li><strong>Isolation</strong> — every gym&apos;s data is separated with row-level security, so one workspace can never see another&apos;s.</li>
                <li><strong>Encryption</strong> — data is encrypted in transit (TLS) and at rest.</li>
                <li><strong>Payments</strong> — card details are tokenised by our PCI-DSS compliant payments partner; we never see raw card numbers.</li>
                <li><strong>Access</strong> — staff access is role-based and logged in an immutable audit trail.</li>
              </ul>
              <h3>Reporting a vulnerability</h3>
              <p>Found something? Email <a href="mailto:security@gymflow.ng" style={{ color: 'var(--gf-brand)' }}>security@gymflow.ng</a> and we&apos;ll respond quickly. We&apos;re grateful to researchers who disclose responsibly.</p>
            </section>
          </div>
        </div>
      </section>

      </main>

      <MarketingFooter />
    </>
  );
}

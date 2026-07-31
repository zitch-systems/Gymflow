import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BreadcrumbLd } from '@/components/marketing/breadcrumb-ld';
import { MessageSquare, Mail, Clock } from 'lucide-react';
import { ContactForm } from '@/components/marketing/contact-form';

const contactDescription = "Questions about pricing, migrations, or a custom plan? We reply within one to two working days.";

export const metadata = {
  title: 'Contact',
  description: contactDescription,
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact · GymFlow',
    description: contactDescription,
    url: '/contact',
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact · GymFlow',
    description: contactDescription,
    images: ['/images/og.png'],
  },
};

export default function ContactPage() {
  return (
    <>
      <BreadcrumbLd name="Contact" path="/contact" />
      <MarketingNav cur="contact" />

      <main id="main-content">
        <header className="phero">
          <div className="wrap">
            <span className="eyebrow"><MessageSquare strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Contact</span>
            <h1>Let&apos;s talk about your gym.</h1>
            <p>Questions about pricing, a migration, or a custom plan? We reply within one to two working days.</p>
          </div>
        </header>

        <section className="blk">
          <div className="wrap contact-grid">
            <div className="card-pane">
              <h2>Send us a message</h2>
              <p className="pmuted">Fill this in and we&apos;ll get back to you by email.</p>
              <ContactForm />
            </div>

            <div className="cmethods">
              <a className="cmethod" href="mailto:hello@gymflow.ng">
                <span className="ic"><Mail strokeWidth={1.75} /></span>
                <div><strong>Email</strong><small>hello@gymflow.ng</small></div>
              </a>
              <div className="cmethod" style={{ cursor: 'default' }}>
                <span className="ic"><Clock strokeWidth={1.75} /></span>
                <div><strong>Response time</strong><small>One to two working days</small></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}

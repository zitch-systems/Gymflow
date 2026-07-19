import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { MessageSquare, MessageCircle, Mail, Phone, MapPin } from 'lucide-react';
import { ContactForm } from '@/components/marketing/contact-form';

export const metadata = {
  title: 'Contact',
  description: "Let's talk about your gym — pricing, migrations, or a custom plan. Our Lagos team replies within an hour.",
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact · GymFlow',
    description: "Let's talk about your gym — pricing, migrations, or a custom plan. Our Lagos team replies within an hour.",
    url: '/contact',
    // Per-segment openGraph replaces (not merges) the root layout's — re-declare
    // the root OG image so it isn't dropped for this page.
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact · GymFlow',
    description: "Let's talk about your gym — pricing, migrations, or a custom plan. Our Lagos team replies within an hour.",
    images: ['/images/og.png'],
  },
};

export default function ContactPage() {
  return (
    <>
      <MarketingNav cur="contact" />

      <main id="main-content">
      <header className="phero">
        <div className="wrap">
          <span className="eyebrow"><MessageSquare strokeWidth={1.75} style={{ width: 14, height: 14 }} /> Contact</span>
          <h1>Let&apos;s talk about your gym.</h1>
          <p>Questions about pricing, a migration, or a custom plan? Our Lagos team usually replies within an hour during business hours.</p>
        </div>
      </header>

      <section className="blk">
        <div className="wrap contact-grid">
          <div className="card-pane">
            <h2>Send us a message</h2>
            <p className="pmuted">Fill this in and we&apos;ll get back to you by email or WhatsApp.</p>
            <ContactForm />
          </div>

          <div>
            <div className="cmethods">
              <a className="cmethod" href="https://wa.me/2348000000000" target="_blank" rel="noopener noreferrer">
                <span className="ic"><MessageCircle strokeWidth={1.75} /></span>
                <div><strong>WhatsApp</strong><small>+234 800 GYMFLOW · fastest reply</small></div>
              </a>
              <a className="cmethod" href="mailto:hello@gymflow.ng">
                <span className="ic"><Mail strokeWidth={1.75} /></span>
                <div><strong>Email</strong><small>hello@gymflow.ng</small></div>
              </a>
              <a className="cmethod" href="tel:+2348000000000">
                <span className="ic"><Phone strokeWidth={1.75} /></span>
                <div><strong>Call us</strong><small>Mon–Sat, 8am–8pm WAT</small></div>
              </a>
              <div className="cmethod" style={{ cursor: 'default' }}>
                <span className="ic"><MapPin strokeWidth={1.75} /></span>
                <div><strong>Visit</strong><small>41 Ogudu Road, Lagos, Nigeria</small></div>
              </div>
            </div>
            <div className="mapbox">
              <div className="grid-bg" />
              <div className="pin"><MapPin strokeWidth={1.75} /></div>
            </div>
          </div>
        </div>
      </section>

      </main>

      <MarketingFooter />
    </>
  );
}

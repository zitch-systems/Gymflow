import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import { ContactForm } from '@/components/marketing/contact-form';
import { MessageSquare, MessageCircle, Mail, Phone, MapPin } from 'lucide-react';

export const metadata = {
  title: 'Contact',
  description:
    'Questions about pricing, a migration, or a custom plan? Our Lagos team usually replies within an hour during business hours.',
};

export default function ContactPage() {
  return (
    <div className="marketing">
      <MarketingNav />
      <main id="main-content" tabIndex={-1}>
        <header className="marketing-hero">
          <div className="container">
            <span className="marketing-eyebrow"><MessageSquare size={14} strokeWidth={2} /> Contact</span>
            <h1 className="marketing-hero-title">Let’s talk about your gym.</h1>
            <p className="marketing-hero-sub">
              Questions about pricing, a migration, or a custom plan? Our Lagos team usually replies within
              an hour during business hours.
            </p>
          </div>
        </header>

        <section className="marketing-section">
          <div className="container mk-contact-grid">
            <div className="mk-card-pane">
              <h2 className="mk-card-pane-title">Send us a message</h2>
              <p className="mk-contact-lead">Fill this in and we’ll get back to you by email or WhatsApp.</p>
              <ContactForm />
            </div>

            <div className="mk-contact-side">
              <div className="mk-cmethods">
                <a className="mk-cmethod" href="https://wa.me/2348166938327" target="_blank" rel="noopener noreferrer">
                  <span className="mk-cmethod-ic" aria-hidden><MessageCircle size={20} strokeWidth={1.9} /></span>
                  <div><strong>WhatsApp</strong><small>+234 816 693 8327 · fastest reply</small></div>
                </a>
                <a className="mk-cmethod" href="mailto:hello@gymflow.ng">
                  <span className="mk-cmethod-ic" aria-hidden><Mail size={20} strokeWidth={1.9} /></span>
                  <div><strong>Email</strong><small>hello@gymflow.ng</small></div>
                </a>
                <a className="mk-cmethod" href="tel:+2348166938327">
                  <span className="mk-cmethod-ic" aria-hidden><Phone size={20} strokeWidth={1.9} /></span>
                  <div><strong>Call us</strong><small>Mon–Sat, 8am–8pm WAT</small></div>
                </a>
                <div className="mk-cmethod mk-cmethod-static">
                  <span className="mk-cmethod-ic" aria-hidden><MapPin size={20} strokeWidth={1.9} /></span>
                  <div><strong>Visit</strong><small>41 Ogudu Road, Lagos, Nigeria</small></div>
                </div>
              </div>
              <div className="mk-mapbox" aria-hidden>
                <div className="mk-mapbox-grid" />
                <div className="mk-mapbox-pin"><MapPin size={22} strokeWidth={2} /></div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

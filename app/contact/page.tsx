import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { MessageSquare, MessageCircle, Mail, Phone, MapPin, Send } from 'lucide-react';

export const metadata = {
  title: 'Contact',
  description: "Let's talk about your gym — pricing, migrations, or a custom plan. Our Lagos team replies within an hour.",
};

export default function ContactPage() {
  return (
    <>
      <MarketingNav cur="contact" />

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
            <form className="cform" action="mailto:hello@gymflow.ng" method="post" encType="text/plain">
              <div className="gf-form-group"><label className="gf-form-label">First name</label><input className="gf-input" name="first" placeholder="Tunde" required /></div>
              <div className="gf-form-group"><label className="gf-form-label">Last name</label><input className="gf-input" name="last" placeholder="Adeyemi" /></div>
              <div className="gf-form-group full"><label className="gf-form-label">Email</label><input className="gf-input" type="email" name="email" placeholder="you@yourgym.ng" required /></div>
              <div className="gf-form-group full"><label className="gf-form-label">Gym name</label><input className="gf-input" name="gym" placeholder="e.g. Powerhouse Fitness" /></div>
              <div className="gf-form-group full">
                <label className="gf-form-label">What can we help with?</label>
                <select className="gf-select" name="topic">
                  <option>Booking a demo</option>
                  <option>Pricing &amp; plans</option>
                  <option>Migrating from another system</option>
                  <option>Partnership</option>
                  <option>Something else</option>
                </select>
              </div>
              <div className="gf-form-group full"><label className="gf-form-label">Message</label><textarea className="gf-textarea" name="message" placeholder="Tell us a little about your gym…" style={{ minHeight: 110 }} /></div>
              <button className="gf-btn gf-btn-primary gf-btn-lg full" type="submit"><Send strokeWidth={1.75} style={{ width: 17, height: 17 }} /> Send message</button>
            </form>
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

      <MarketingFooter />
    </>
  );
}

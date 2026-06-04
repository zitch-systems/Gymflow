'use client';

import { useState } from 'react';
import { Send, Check } from 'lucide-react';

// Marketing contact form. No backend wired here — on submit it swaps to a
// success state (matches the revamp/contact.html prototype). When a real
// inbox/endpoint exists, POST the fields in handleSubmit before setSent.
export function ContactForm() {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="mk-cform-done">
        <div className="mk-cform-check" aria-hidden><Check size={34} strokeWidth={2.5} /></div>
        <h2>Message sent</h2>
        <p>Thanks for reaching out — we’ll reply within an hour during business hours.</p>
      </div>
    );
  }

  return (
    <form
      className="mk-cform"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
    >
      <div className="gf-form-group">
        <label className="gf-form-label" htmlFor="cf-first">First name</label>
        <input id="cf-first" className="gf-input" placeholder="Tunde" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-form-label" htmlFor="cf-last">Last name</label>
        <input id="cf-last" className="gf-input" placeholder="Adeyemi" />
      </div>
      <div className="gf-form-group mk-cform-full">
        <label className="gf-form-label" htmlFor="cf-email">Email</label>
        <input id="cf-email" className="gf-input" type="email" placeholder="you@yourgym.ng" required />
      </div>
      <div className="gf-form-group mk-cform-full">
        <label className="gf-form-label" htmlFor="cf-gym">Gym name</label>
        <input id="cf-gym" className="gf-input" placeholder="e.g. Powerhouse Fitness" />
      </div>
      <div className="gf-form-group mk-cform-full">
        <label className="gf-form-label" htmlFor="cf-topic">What can we help with?</label>
        <select id="cf-topic" className="gf-select" defaultValue="Booking a demo">
          <option>Booking a demo</option>
          <option>Pricing &amp; plans</option>
          <option>Migrating from another system</option>
          <option>Partnership</option>
          <option>Something else</option>
        </select>
      </div>
      <div className="gf-form-group mk-cform-full">
        <label className="gf-form-label" htmlFor="cf-msg">Message</label>
        <textarea id="cf-msg" className="gf-textarea" placeholder="Tell us a little about your gym…" style={{ minHeight: 110 }} />
      </div>
      <button type="submit" className="gf-btn gf-btn-primary gf-btn-lg mk-cform-full">
        <Send size={17} strokeWidth={2} /> Send message
      </button>
    </form>
  );
}

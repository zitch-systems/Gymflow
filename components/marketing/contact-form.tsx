'use client';

import { useActionState } from 'react';
import { Send, Check, AlertCircle } from 'lucide-react';
import { submitContact, type ContactState } from '@/lib/actions/contact';

const initial: ContactState = { ok: false, error: null };

// Marketing contact form — submits to the support inbox (superadmin Support).
export function ContactForm() {
  const [state, action, pending] = useActionState(submitContact, initial);
  // submitContact returns one generic error (rate-limited / DB failure / bad
  // email), not per-field — tie it to the two required inputs it can be about.
  const errorId = 'contact-form-error';

  if (state.ok) {
    return (
      <div className="empty" style={{ padding: '34px 10px' }} role="status">
        <div className="eic" style={{ color: 'var(--gf-brand)' }}><Check strokeWidth={1.6} /></div>
        <h3>Message sent</h3>
        <p>Thanks — we&apos;ll get back to you by email or WhatsApp, usually within the hour.</p>
      </div>
    );
  }

  return (
    <form className="cform" action={action} aria-busy={pending}>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
      <div className="gf-form-group"><label className="gf-form-label">First name</label><input className="gf-input" name="first" placeholder="Tunde" required aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} /></div>
      <div className="gf-form-group"><label className="gf-form-label">Last name</label><input className="gf-input" name="last" placeholder="Adeyemi" /></div>
      <div className="gf-form-group full"><label className="gf-form-label">Email</label><input className="gf-input" type="email" name="email" placeholder="you@yourgym.ng" required aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? errorId : undefined} /></div>
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
      {state.error && <p id={errorId} role="alert" className="full" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: 0 }}><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <button className="gf-btn gf-btn-primary gf-btn-lg full" type="submit" disabled={pending}>
        <Send strokeWidth={1.75} style={{ width: 17, height: 17 }} /> {pending ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}

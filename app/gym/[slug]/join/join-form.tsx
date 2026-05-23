'use client';

import { useActionState } from 'react';
import { signUp } from '@/lib/auth/actions';

export function JoinForm({ gymSlug }: { gymSlug: string }) {
  const [state, formAction, pending] = useActionState(signUp, undefined);

  return (
    <form action={formAction} className="join-form" noValidate>
      <input type="hidden" name="gym" value={gymSlug} />

      {state?.error && (
        <div className="gf-error show" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{state.error}</span>
        </div>
      )}

      <section className="gf-card-elevated">
        <h2 className="gf-h3">Personal details</h2>
        <div className="form-grid">
          <Field label="Full name" name="full_name" required autoComplete="name" placeholder="Your full name" />
          <Field label="Email" name="email" type="email" required autoComplete="email" placeholder="you@email.com" />
          <Field label="Phone" name="phone" type="tel" required autoComplete="tel" placeholder="08012345678" />
          <Field
            label="Password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Min 6 characters"
          />
          <Field label="Date of birth" name="date_of_birth" type="date" />
          <div className="gf-form-group">
            <label className="gf-label" htmlFor="gender">
              Gender
            </label>
            <select id="gender" name="gender" className="gf-select">
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="gf-form-group form-grid-full">
            <label className="gf-label" htmlFor="address">
              Address
            </label>
            <textarea id="address" name="address" rows={2} className="gf-input" placeholder="Your home address" />
          </div>
        </div>
      </section>

      <section className="gf-card-elevated">
        <h2 className="gf-h3">Emergency contact</h2>
        <div className="form-grid">
          <Field label="Contact name" name="nok_name" required placeholder="Next of kin name" />
          <div className="gf-form-group">
            <label className="gf-label" htmlFor="nok_relationship">
              Relationship <span className="req">*</span>
            </label>
            <select id="nok_relationship" name="nok_relationship" required className="gf-select">
              <option value="">Select</option>
              <option value="parent">Parent</option>
              <option value="spouse">Spouse</option>
              <option value="sibling">Sibling</option>
              <option value="child">Child</option>
              <option value="friend">Friend</option>
              <option value="other">Other</option>
            </select>
          </div>
          <Field label="Contact phone" name="nok_phone" type="tel" required placeholder="08087654321" />
          <Field label="Contact address" name="nok_address" placeholder="Optional" />
        </div>
      </section>

      <section className="gf-card-elevated">
        <h2 className="gf-h3">Health info</h2>
        <div className="gf-form-group">
          <label className="gf-label" htmlFor="health_notes">
            Medical conditions / allergies
          </label>
          <textarea
            id="health_notes"
            name="health_notes"
            rows={3}
            className="gf-input"
            placeholder="Any conditions we should know about…"
          />
          <p className="gf-form-hint">Helps trainers keep you safe.</p>
        </div>
      </section>

      <label className="gf-waiver">
        <input type="checkbox" name="waiver_signed" required className="gf-check" />
        <span>
          <strong>I agree to the terms &amp; conditions.</strong>
          <br />
          <span className="gf-form-hint">
            I have read the safety guidelines, waive liability for training injuries, and agree to follow all gym rules.
          </span>
        </span>
      </label>

      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">
        {pending ? 'Creating…' : 'Create membership'}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="gf-form-group">
      <label className="gf-label" htmlFor={name}>
        {label} {required && <span className="req">*</span>}
      </label>
      <input id={name} name={name} type={type} required={required} className="gf-input" {...rest} />
    </div>
  );
}

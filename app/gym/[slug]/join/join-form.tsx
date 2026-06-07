'use client';

import { useActionState } from 'react';
import { signUp } from '@/lib/auth/actions';
import { User, ShieldAlert, HeartPulse } from 'lucide-react';

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

      <Section
        step={1}
        icon={<User size={18} strokeWidth={2} />}
        title="About you"
        sub="The basics we need to create your account."
      >
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
          placeholder="At least 6 characters"
          hint="You'll use this to sign in next time."
        />
        <Field label="Date of birth" name="date_of_birth" type="date" optional />
        <div className="gf-form-group">
          <label className="gf-label" htmlFor="gender">Gender <span className="gf-optional">Optional</span></label>
          <select id="gender" name="gender" className="gf-select">
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="gf-form-group form-grid-full">
          <label className="gf-label" htmlFor="address">Address <span className="gf-optional">Optional</span></label>
          <textarea id="address" name="address" rows={2} className="gf-input" placeholder="Your home address" />
        </div>
      </Section>

      <Section
        step={2}
        icon={<ShieldAlert size={18} strokeWidth={2} />}
        title="Emergency contact"
        sub="Who should we call if something happens during a workout?"
      >
        <Field label="Contact name" name="nok_name" required placeholder="Next of kin name" />
        <div className="gf-form-group">
          <label className="gf-label" htmlFor="nok_relationship">Relationship <span className="req">*</span></label>
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
        <Field label="Contact address" name="nok_address" optional placeholder="Street, city" />
      </Section>

      <Section
        step={3}
        icon={<HeartPulse size={18} strokeWidth={2} />}
        title="Anything we should know?"
        sub="Optional — but it helps your coach keep you safe."
      >
        <div className="gf-form-group form-grid-full">
          <label className="gf-label" htmlFor="health_notes">Medical conditions or allergies <span className="gf-optional">Optional</span></label>
          <textarea
            id="health_notes"
            name="health_notes"
            rows={3}
            className="gf-input"
            placeholder="Asthma, knee injury, lactose-intolerant…"
          />
        </div>
      </Section>

      <label className="gf-waiver">
        <input type="checkbox" name="waiver_signed" required className="gf-check" />
        <span>
          <strong>I agree to the terms &amp; conditions.</strong>
          <br />
          <span className="gf-form-hint">
            I&apos;ve read the safety guidelines, waive liability for training injuries, and agree to follow all gym rules.
          </span>
        </span>
      </label>

      <div className="join-submit-bar">
        <button type="submit" disabled={pending} className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">
          {pending ? 'Creating your membership…' : 'Create my membership'}
        </button>
        <p className="gf-form-hint" style={{ textAlign: 'center', marginTop: 6 }}>
          By continuing you agree to GymFlow&apos;s privacy policy.
        </p>
      </div>
    </form>
  );
}

function Section({ step, icon, title, sub, children }: { step: number; icon: React.ReactNode; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="join-section">
      <header className="join-section-head">
        <span className="join-section-step">{step}</span>
        <span className="join-section-icon" aria-hidden>{icon}</span>
        <div>
          <h2 className="join-section-title">{title}</h2>
          <p className="join-section-sub">{sub}</p>
        </div>
      </header>
      <div className="form-grid join-section-grid">{children}</div>
    </section>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
  optional = false,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="gf-form-group">
      <label className="gf-label" htmlFor={name}>
        {label} {required && <span className="req">*</span>}
        {optional && !required && <span className="gf-optional">Optional</span>}
      </label>
      <input id={name} name={name} type={type} required={required} className="gf-input" {...rest} />
      {hint && <p className="gf-form-hint">{hint}</p>}
    </div>
  );
}


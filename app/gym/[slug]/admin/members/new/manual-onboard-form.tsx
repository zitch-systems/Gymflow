'use client';

import { useState, useTransition } from 'react';
import { adminOnboardMember } from '@/lib/actions/members';
import { useToast } from '@/lib/toast';

type Plan = { id: string; name: string; price: number; duration_months: number };

export function ManualOnboardForm({ slug, plans }: { slug: string; plans: Plan[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [planId, setPlanId] = useState('');
  const toast = useToast();

  const selectedPlan = plans.find((p) => p.id === planId);

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const result = await adminOnboardMember(slug, fd);
          if (result && result.error) {
            setError(result.error);
            toast(result.error, 'error');
          }
          // Success path redirects via the server action; nothing else to do here.
        });
      }}
    >
      {error && (
        <div className="gf-error show form-grid-full" role="alert">
          {error}
        </div>
      )}

      <div className="gf-form-group">
        <label className="gf-label" htmlFor="full_name">
          Full name <span className="req">*</span>
        </label>
        <input id="full_name" name="full_name" className="gf-input" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="email">
          Email <span className="req">*</span>
        </label>
        <input id="email" name="email" type="email" className="gf-input" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="phone">
          Phone
        </label>
        <input id="phone" name="phone" type="tel" className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="date_of_birth">
          Date of birth
        </label>
        <input id="date_of_birth" name="date_of_birth" type="date" className="gf-input" />
      </div>
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
        <textarea id="address" name="address" rows={2} className="gf-input" />
      </div>

      <h3 className="gf-h3 form-grid-full" style={{ marginTop: 8 }}>
        Emergency contact
      </h3>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="nok_name">
          Contact name
        </label>
        <input id="nok_name" name="nok_name" className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="nok_relationship">
          Relationship
        </label>
        <input id="nok_relationship" name="nok_relationship" className="gf-input" placeholder="Parent / Spouse / …" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="nok_phone">
          Contact phone
        </label>
        <input id="nok_phone" name="nok_phone" className="gf-input" />
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="health_notes">
          Health notes / allergies
        </label>
        <textarea id="health_notes" name="health_notes" rows={2} className="gf-input" />
      </div>
      <label className="gf-form-group form-grid-full" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" name="waiver_signed" className="gf-check" defaultChecked />
        <span>Member has signed the gym waiver in person.</span>
      </label>

      <h3 className="gf-h3 form-grid-full" style={{ marginTop: 8 }}>
        Initial payment (optional)
      </h3>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="plan_id">
          Plan
        </label>
        <select
          id="plan_id"
          name="plan_id"
          className="gf-select"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <option value="">No plan / leave inactive</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.duration_months}mo · ₦{Number(p.price).toLocaleString('en-NG')}
            </option>
          ))}
        </select>
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="payment_amount">
          Amount received (₦)
        </label>
        <input
          id="payment_amount"
          name="payment_amount"
          type="number"
          min="0"
          step="100"
          className="gf-input"
          defaultValue={selectedPlan?.price ?? 0}
        />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="payment_method">
          Method
        </label>
        <select id="payment_method" name="payment_method" className="gf-select" defaultValue="cash">
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="pos">POS</option>
          <option value="other">Other</option>
        </select>
      </div>

      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Onboarding…' : 'Onboard member'}
      </button>
    </form>
  );
}

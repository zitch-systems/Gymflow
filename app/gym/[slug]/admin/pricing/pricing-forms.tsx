'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPlan, deletePlan } from '@/lib/actions/plans';
import { useToast } from '@/lib/toast';

export function PlanCreateForm({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await createPlan(slug, fd);
          (e.currentTarget as HTMLFormElement).reset();
          toast('Plan created', 'success');
          router.refresh();
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="plan-name">
          Name <span className="req">*</span>
        </label>
        <input id="plan-name" name="name" className="gf-input" required placeholder="e.g. Monthly · ₦20,000" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="plan-price">
          Price (₦) <span className="req">*</span>
        </label>
        <input id="plan-price" name="price" type="number" min="0" step="1" className="gf-input" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="plan-duration">
          Duration (months) <span className="req">*</span>
        </label>
        <input
          id="plan-duration"
          name="duration_months"
          type="number"
          min="1"
          step="1"
          defaultValue={1}
          className="gf-input"
          required
        />
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="plan-desc">
          Description
        </label>
        <textarea id="plan-desc" name="description" rows={2} className="gf-input" />
      </div>
      <label className="gf-form-group form-grid-full" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" name="is_active" defaultChecked className="gf-check" />
        <span>Active (visible to members)</span>
      </label>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Saving…' : 'Create plan'}
      </button>
    </form>
  );
}

export function PlanDeleteButton({ slug, planId }: { slug: string; planId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <button
      type="button"
      className="gf-btn gf-btn-ghost gf-btn-sm"
      disabled={pending}
      onClick={() => {
        if (!confirm('Delete this plan? Members already subscribed are unaffected.')) return;
        start(async () => {
          await deletePlan(slug, planId);
          toast('Plan deleted', 'success');
          router.refresh();
        });
      }}
    >
      {pending ? '…' : 'Delete'}
    </button>
  );
}

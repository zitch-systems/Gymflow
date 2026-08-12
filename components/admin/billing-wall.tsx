import { LogOut } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { PlanCards } from '@/components/admin/plan-cards';
import type { BillingState, BillingCycle, PlanTier } from '@/lib/platform-plans';

// Full-screen access wall rendered by the admin layout when the gym's GymFlow
// subscription is lapsed (trial_expired) or cancelled. Nothing else in /admin is
// reachable until they subscribe — but the Paystack checkout it links to is what
// reactivates them (handled by the webhook), so there's no lock-out loop.
export function BillingWall({ state, gymName, currentTier, currentCycle }: { state: BillingState; gymName: string; currentTier?: PlanTier | null; currentCycle?: BillingCycle | null }) {
  const heading =
    state === 'trial_expired' ? 'Your free trial has ended'
    : state === 'suspended' ? 'Your subscription is overdue'
    : 'Your subscription was cancelled';
  return (
    <div className="ds-admin" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 1000 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <span className="pill-plat">GymFlow subscription</span>
          <h1 style={{ margin: '10px 0 6px' }}>{heading}</h1>
          <p style={{ color: 'var(--gf-text-muted)', maxWidth: 560, margin: '0 auto' }}>
            {gymName}’s GymFlow access is paused. Choose a plan to reactivate the admin console — your members,
            classes and data are all exactly where you left them.
          </p>
        </div>
        <PlanCards currentTier={currentTier} currentCycle={currentCycle} />
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <form action={signOut}>
            <button type="submit" className="gf-btn gf-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={15} strokeWidth={1.8} /> Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

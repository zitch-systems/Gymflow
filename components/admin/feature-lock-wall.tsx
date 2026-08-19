import { Lock, LogOut } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';

// Full-screen wall for a Growth-only surface (the member app, the instructor
// portal) on a Starter gym. Distinct from SuspendedWall (a platform-level
// suspension, fixed by contacting GymFlow support) and BillingWall (a lapsed
// subscription, fixed by paying again) — this one is a plan choice, fixed by
// upgrading. See lib/entitlements.ts member_app / instructor_portal.
//
// 'staff' can act on it — instructors and owners land in /admin/billing, which
// only the owner can actually check out from, but any staff role can at least
// see what upgrading buys. 'member' has no billing relationship with GymFlow
// at all (the gym is the one who chose Starter), so that audience gets a
// dead-end wall pointing back at the gym, matching SuspendedWall's member copy.
export type FeatureLockAudience = 'staff' | 'member';

export function FeatureLockWall({
  gymName, featureLabel, audience = 'staff',
}: {
  gymName: string;
  featureLabel: string;
  audience?: FeatureLockAudience;
}) {
  const staff = audience === 'staff';
  return (
    <div
      className={staff ? 'ds-admin' : 'ds-member'}
      style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem' }}
    >
      <div style={{ width: '100%', maxWidth: 560, textAlign: 'center' }}>
        <div
          style={{
            width: 62, height: 62, borderRadius: 20, margin: '0 auto 18px',
            display: 'grid', placeItems: 'center',
            background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)',
            border: '1px solid rgba(var(--gf-brand-rgb), 0.25)',
          }}
        >
          <Lock size={28} strokeWidth={1.8} />
        </div>
        {staff && <span className="pill-plat">GymFlow plan</span>}
        <h1 style={{ margin: '10px 0 6px' }}>
          {staff ? `${featureLabel} isn’t on ${gymName}’s plan` : `${gymName} hasn’t turned this on`}
        </h1>
        <p style={{ color: 'var(--gf-text-muted)', margin: '0 auto 22px' }}>
          {staff ? (
            <>
              The {featureLabel.toLowerCase()} is part of GymFlow’s Growth plan. The gym owner can switch plans
              from Billing → Plans in the admin console — nothing about {gymName}’s existing data changes either way.
            </>
          ) : (
            <>
              {gymName} is on a GymFlow plan that doesn’t include the member app yet. Please contact the gym
              directly for updates on your membership, classes or payments.
            </>
          )}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {staff && (
            <a className="gf-btn gf-btn-primary" href="/admin/billing">
              Go to Billing
            </a>
          )}
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

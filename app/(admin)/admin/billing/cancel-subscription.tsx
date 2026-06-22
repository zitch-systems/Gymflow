'use client';

import { cancelPlatformSubscription } from '@/lib/actions/platform-billing';

// Owner-only "cancel subscription" control. Confirms client-side, then calls the
// owner-gated server action, which redirects back to /admin/billing with the
// outcome in the query string (rendered by the page).
export function CancelSubscription() {
  return (
    <form
      action={cancelPlatformSubscription}
      onSubmit={(e) => { if (!confirm('Cancel your GymFlow subscription? You keep access until the current period ends.')) e.preventDefault(); }}
      style={{ marginTop: 14 }}
    >
      <button type="submit" className="gf-btn gf-btn-ghost" style={{ color: 'var(--gf-danger, #ff4560)' }}>
        Cancel subscription
      </button>
    </form>
  );
}

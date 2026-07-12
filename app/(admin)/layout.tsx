import { AdminShell } from '@/components/admin/admin-shell';
import { BillingWall } from '@/components/admin/billing-wall';
import { OnboardingBanner } from '@/components/admin/onboarding-banner';
import { requireAdminStaff, getProfile, getStaffGyms, ADMIN_ROLES } from '@/lib/auth/dal';
import { gymBillingState, isBlocked, isPlanTier } from '@/lib/platform-plans';
import { initialsOf, roleLabel } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

// The gate hits Supabase on every /admin/* request; allow headroom for a
// resuming (auto-paused) free-tier project so it doesn't 504 the first load.
export const maxDuration = 60;

// Authenticated console — keep it out of search indexes (defence-in-depth on
// top of the robots.txt Disallow, which is only advisory).
export const metadata = { robots: { index: false, follow: false } };

// Admin console shell — sidebar + topbar around every /admin/* route.
// requireAdminStaff() gates the group: owner/manager/front-desk/accountant.
// Instructors are routed to /coach (via /launch) — they must not see member
// PII, payments, pricing or gym settings. Content sits inside .ds-admin.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, gym, role } = await requireAdminStaff();

  // Platform-billing gate: a gym whose free trial has lapsed (or whose GymFlow
  // subscription was cancelled) sees the access wall instead of the console. The
  // wall's checkout reactivates them via the webhook — no lock-out loop. past_due
  // is not blocked (Paystack retries); the page-level banner warns instead.
  const state = gymBillingState(gym);
  if (isBlocked(state)) {
    const tier = isPlanTier(gym.subscription_plan ?? '') ? (gym.subscription_plan as 'starter' | 'growth' | 'scale') : null;
    return <BillingWall state={state} gymName={gym.name} currentTier={tier} />;
  }

  const supabase = await createClient();
  // Pending freeze requests — surfaced as a badge on the Members nav item so
  // staff can see "there's a request waiting" without opening every profile.
  const [profile, staffGyms, freezeCountRes] = await Promise.all([
    getProfile(),
    getStaffGyms(ADMIN_ROLES),
    supabase.from('member_subscriptions').select('id', { head: true, count: 'exact' })
      .eq('gym_id', gym.id).eq('status', 'pause_requested'),
  ]);
  const name = profile?.full_name?.trim() || user.email?.split('@')[0] || roleLabel(role);
  const meta = `${gym.city ? `${gym.city} · ` : ''}${gym.slug}.gymflow.ng`;
  const pendingFreezes = freezeCountRes.count ?? 0;

  return (
    <AdminShell
      gymName={gym.name}
      gymMeta={meta}
      gymInitial={initialsOf(gym.name, 'G')}
      userName={name}
      userRole={roleLabel(role)}
      userInitial={initialsOf(name)}
      gyms={staffGyms.gyms}
      activeGymId={staffGyms.activeId}
      pendingFreezes={pendingFreezes}
    >
      <OnboardingBanner gymId={gym.id} />
      {children}
    </AdminShell>
  );
}

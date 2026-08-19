import { CoachShell } from '@/components/coach/coach-shell';
import { SuspendedWall } from '@/components/admin/suspended-wall';
import { FeatureLockWall } from '@/components/admin/feature-lock-wall';
import { requireInstructor, getProfile, getStaffGyms, INSTRUCTOR_ROLES } from '@/lib/auth/dal';
import { isOfflineGym } from '@/lib/gym-status';
import { gymCanUse } from '@/lib/entitlements';
import { initialsOf } from '@/lib/format';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Authenticated instructor portal — keep out of search indexes.
export const metadata = { robots: { index: false, follow: false } };

// Instructor portal shell. requireInstructor() gates the group (instructor /
// manager / gym_owner). Reuses the .ds-admin namespace + instructor widgets.
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const { user, gym } = await requireInstructor();
  // Same wall the admin console shows — a coach is staff, and a switched-off
  // gym has no classes to run. See app/(admin)/layout.tsx.
  if (isOfflineGym(gym)) return <SuspendedWall gymName={gym.name} />;
  // Starter is the gym admin portal only — the instructor portal is a Growth
  // surface. gymCanUse grandfathers gyms that already existed before this
  // change (see gyms.legacy_full_access). A coach is staff (unlike a member),
  // so this points at Billing rather than dead-ending — see FeatureLockWall's
  // 'staff' audience.
  if (!gymCanUse(gym, 'instructor_portal')) return <FeatureLockWall gymName={gym.name} featureLabel="The instructor portal" />;
  const [profile, staffGyms] = await Promise.all([getProfile(), getStaffGyms(INSTRUCTOR_ROLES)]);
  const name = profile?.full_name?.trim() || user.email?.split('@')[0] || 'Instructor';
  const sharePct = (gym as { instructor_revenue_share_pct?: number | null }).instructor_revenue_share_pct ?? null;
  return (
    <CoachShell gymName={gym.name} userName={name} userInitial={initialsOf(name)} sharePct={sharePct} gyms={staffGyms.gyms} activeGymId={staffGyms.activeId}>
      {children}
    </CoachShell>
  );
}

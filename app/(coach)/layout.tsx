import { CoachShell } from '@/components/coach/coach-shell';
import { requireInstructor, getProfile, getStaffGyms, INSTRUCTOR_ROLES } from '@/lib/auth/dal';
import { initialsOf } from '@/lib/format';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Instructor portal shell. requireInstructor() gates the group (instructor /
// manager / gym_owner). Reuses the .ds-admin namespace + instructor widgets.
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const { user, gym } = await requireInstructor();
  const [profile, staffGyms] = await Promise.all([getProfile(), getStaffGyms(INSTRUCTOR_ROLES)]);
  const name = profile?.full_name?.trim() || user.email?.split('@')[0] || 'Instructor';
  const sharePct = (gym as { instructor_revenue_share_pct?: number | null }).instructor_revenue_share_pct ?? null;
  return (
    <CoachShell gymName={gym.name} userName={name} userInitial={initialsOf(name)} sharePct={sharePct} gyms={staffGyms.gyms} activeGymId={staffGyms.activeId}>
      {children}
    </CoachShell>
  );
}

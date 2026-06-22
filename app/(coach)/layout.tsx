import { CoachShell } from '@/components/coach/coach-shell';
import { requireInstructor, getProfile } from '@/lib/auth/dal';
import { initialsOf } from '@/lib/format';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Instructor portal shell. requireInstructor() gates the group (instructor /
// manager / gym_owner). Reuses the .ds-admin namespace + instructor widgets.
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const { user, gym } = await requireInstructor();
  const profile = await getProfile();
  const name = profile?.full_name?.trim() || user.email?.split('@')[0] || 'Instructor';
  const sharePct = (gym as { instructor_revenue_share_pct?: number | null }).instructor_revenue_share_pct ?? null;
  return (
    <CoachShell gymName={gym.name} userName={name} userInitial={initialsOf(name)} sharePct={sharePct}>
      {children}
    </CoachShell>
  );
}

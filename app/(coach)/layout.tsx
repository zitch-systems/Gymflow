import { CoachShell } from '@/components/coach/coach-shell';
import { requireInstructor } from '@/lib/auth/dal';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Instructor portal shell. requireInstructor() gates the group (instructor /
// manager / gym_owner). Reuses the .ds-admin namespace + instructor widgets.
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  await requireInstructor();
  return <CoachShell>{children}</CoachShell>;
}

import { CoachShell } from '@/components/coach/coach-shell';
import { requireInstructor } from '@/lib/auth/dal';

// Instructor portal shell. requireInstructor() gates the group (instructor /
// manager / gym_owner). Reuses the .ds-admin namespace + instructor widgets.
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  await requireInstructor();
  return <CoachShell>{children}</CoachShell>;
}

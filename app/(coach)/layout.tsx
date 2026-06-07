import { CoachShell } from '@/components/coach/coach-shell';

// Instructor portal shell. Reuses the .ds-admin namespace (instructor pages
// share admin's KPI/panel/grid primitives) plus instructor-only widgets
// (.tl timeline, .roster, .cl-row, .ec chart, .payout) ported to .ds-admin.
export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return <CoachShell>{children}</CoachShell>;
}

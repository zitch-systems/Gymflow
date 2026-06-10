import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdminStaff } from '@/lib/auth/dal';

// The gate hits Supabase on every /admin/* request; allow headroom for a
// resuming (auto-paused) free-tier project so it doesn't 504 the first load.
export const maxDuration = 60;

// Admin console shell — sidebar + topbar around every /admin/* route.
// requireAdminStaff() gates the group: owner/manager/front-desk/accountant.
// Instructors are routed to /coach (via /launch) — they must not see member
// PII, payments, pricing or gym settings. Content sits inside .ds-admin.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminStaff();
  return <AdminShell>{children}</AdminShell>;
}

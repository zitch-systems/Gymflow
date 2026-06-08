import { AdminShell } from '@/components/admin/admin-shell';
import { requireStaff } from '@/lib/auth/dal';

// requireStaff() hits Supabase on every /admin/* request; allow headroom for a
// resuming (auto-paused) free-tier project so it doesn't 504 the first load.
export const maxDuration = 60;

// Admin console shell — sidebar + topbar around every /admin/* route.
// requireStaff() gates the group (any active gym staff link); non-staff are
// redirected to /login. Content sits inside .ds-admin (set by AdminShell).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <AdminShell>{children}</AdminShell>;
}

import { AdminShell } from '@/components/admin/admin-shell';
import { requireStaff } from '@/lib/auth/dal';

// Admin console shell — sidebar + topbar around every /admin/* route.
// requireStaff() gates the group (any active gym staff link); non-staff are
// redirected to /login. Content sits inside .ds-admin (set by AdminShell).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <AdminShell>{children}</AdminShell>;
}

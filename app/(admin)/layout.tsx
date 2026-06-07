import { AdminShell } from '@/components/admin/admin-shell';

// Admin console shell — sidebar + topbar around every /admin/* route.
// Everything sits inside .ds-admin so the namespaced admin content styles
// (.kpis, .panel, .tbl, .who, .clx, .balance, etc.) apply.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}

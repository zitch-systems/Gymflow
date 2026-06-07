import { SuperShell } from '@/components/superadmin/super-shell';

// Platform-admin console. Reuses .ds-admin (super pages share admin's KPI/
// panel/table primitives) + super-only widgets (.gt/.gname, .act-row,
// .dstat, .pill-plat) ported to .ds-admin.
export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return <SuperShell>{children}</SuperShell>;
}

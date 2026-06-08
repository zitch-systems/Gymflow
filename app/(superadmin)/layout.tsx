import { SuperShell } from '@/components/superadmin/super-shell';
import { requirePlatformAdmin } from '@/lib/auth/dal';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Platform-admin console. requirePlatformAdmin() gates the group (must be an
// active row in platform_admins); everyone else is redirected to /.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <SuperShell>{children}</SuperShell>;
}

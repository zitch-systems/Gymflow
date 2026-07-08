import { SuperShell } from '@/components/superadmin/super-shell';
import { requirePlatformAdmin, getProfile } from '@/lib/auth/dal';
import { initialsOf } from '@/lib/format';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Platform-admin console — keep out of search indexes.
export const metadata = { robots: { index: false, follow: false } };

// Platform-admin console. requirePlatformAdmin() gates the group (must be an
// active row in platform_admins); everyone else is redirected to /.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  // getProfile only depends on the cached getUser(), so it overlaps the gate.
  const profileP = getProfile().catch(() => null);
  const user = await requirePlatformAdmin();
  const profile = await profileP;
  const name = profile?.full_name?.trim() || user.email?.split('@')[0] || 'Superadmin';
  return (
    <SuperShell userName={name} userEmail={user.email ?? ''} userInitial={initialsOf(name, 'S')}>
      {children}
    </SuperShell>
  );
}

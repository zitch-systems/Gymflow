import { SuperShell } from '@/components/superadmin/super-shell';
import { requirePlatformAdmin, getProfile } from '@/lib/auth/dal';
import { initialsOf } from '@/lib/format';
import { superadminBase } from '@/lib/superadmin-path';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Platform-admin console — keep out of search indexes.
export const metadata = { robots: { index: false, follow: false } };

// Platform-admin console. requirePlatformAdmin() gates the group (must be an
// active row in platform_admins); everyone else is redirected to /.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  const profile = await getProfile();
  const name = profile?.full_name?.trim() || user.email?.split('@')[0] || 'Superadmin';
  return (
    // The shell builds every nav href from this base — it's a Client Component,
    // so the server env has to be handed to it. See lib/superadmin-path.ts.
    <SuperShell base={superadminBase()} userName={name} userEmail={user.email ?? ''} userInitial={initialsOf(name, 'S')}>
      {children}
    </SuperShell>
  );
}

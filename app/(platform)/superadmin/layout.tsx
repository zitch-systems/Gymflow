import '@/app/admin.css';

import { getProfile } from '@/lib/auth/dal';
import { SuperadminShell } from './superadmin-shell';

// Wraps every /superadmin route in the platform sidebar/topbar shell. The pages
// themselves still run their own platform-admin auth gate; this layout only
// fetches the signed-in profile for the footer (null-safe if there's no session).
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  const name = profile?.full_name ?? profile?.email ?? 'Platform admin';

  return (
    <SuperadminShell userName={name} userInitial={name.charAt(0).toUpperCase()}>
      {children}
    </SuperadminShell>
  );
}

import { ConsoleLogin } from './console-login';

export const metadata = {
  title: 'Platform console',
  // Never indexed, never followed. The console's URL is a secret
  // (SUPERADMIN_PATH) and its sign-in must not be the thing that leaks it.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';
// Matches the other auth routes: a resuming Supabase project can take longer
// than the platform default to answer the first sign-in.
export const maxDuration = 60;

// The platform console's own sign-in.
//
// It sits in its own route group, NOT under app/(superadmin), because that
// group's layout calls requirePlatformAdmin() — a sign-in page behind the gate
// it exists to get you through would redirect to itself forever. Same URL
// space, different (ungated) subtree.
//
// Reachable only where the console is: the middleware rewrites
// /<SUPERADMIN_PATH>/login here, and 404s /superadmin/login directly whenever a
// custom segment is configured. So this page is exactly as discoverable as the
// console — no more.
//
// Deliberately not the apex sign-in with different copy. There is no "Create
// gym" tab, no "Forgot password?", no "Launch your gym free": every one of
// those is a self-service path for gym owners, and none of them can create,
// recover, or grant a platform-admin account. Offering them here would be
// three dead ends dressed as help. Platform-admin accounts are provisioned
// deliberately, and a lost password is recovered from the apex
// /forgot-password like any other account.
export default async function ConsoleLoginPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  return <ConsoleLogin denied={sp.denied === 'platform'} />;
}

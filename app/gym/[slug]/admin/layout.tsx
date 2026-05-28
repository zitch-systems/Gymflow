import { requireStaff } from '@/lib/auth/gym';
import { getProfile } from '@/lib/auth/dal';
import { AdminShell } from './admin-shell';
import { PlatformBillingBanner } from './platform-billing-banner';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

const DAY_MS = 86_400_000;

export default async function AdminLayout({ children, params }: LayoutProps) {
  const { slug } = await params;
  const { role, gym } = await requireStaff(slug);
  const profile = await getProfile();

  // Server component running per request — current time is legitimately
  // request-scoped state, not a purity violation. Disable the React Compiler
  // rule for this single computation.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const daysUntilRenewal = gym.trial_ends_at
    ? Math.ceil((new Date(gym.trial_ends_at).getTime() - now) / DAY_MS)
    : null;

  return (
    <AdminShell
      slug={slug}
      gymName={gym.name}
      role={role}
      userName={profile?.full_name ?? profile?.email ?? 'Staff'}
      userInitial={(profile?.full_name ?? profile?.email ?? 'A').charAt(0).toUpperCase()}
    >
      <PlatformBillingBanner
        subscriptionStatus={gym.subscription_status}
        daysUntilRenewal={daysUntilRenewal}
        role={role}
      />
      {children}
    </AdminShell>
  );
}

import { MemberTabBar } from '@/components/member/tabbar';
import { requireAuth } from '@/lib/auth/dal';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Member PWA shell — the .ds-member wrapper scopes the member design system
// and provides the mobile app frame + bottom tab bar. requireAuth() gates the
// whole group: unauthenticated visitors are redirected to /login.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return (
    <div className="ds-member">
      {children}
      <MemberTabBar />
    </div>
  );
}

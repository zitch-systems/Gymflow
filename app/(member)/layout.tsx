import type { CSSProperties } from 'react';
import { MemberTabBar } from '@/components/member/tabbar';
import { CameraPrime } from '@/components/member/camera-prime';
import { WaiverWall } from '@/components/member/waiver-wall';
import { SuspendedWall } from '@/components/admin/suspended-wall';
import { requireMember, getProfile } from '@/lib/auth/dal';
import { isOfflineGym } from '@/lib/gym-status';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Authenticated member PWA — keep out of search indexes.
export const metadata = { robots: { index: false, follow: false } };

// Member PWA shell — the .ds-member wrapper scopes the member design system
// and provides the mobile app frame + bottom tab bar. requireMember() gates the
// group and resolves the gym, whose accent colour (if set) re-tints the brand
// tokens across the member app.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { gym } = await requireMember();

  // A gym the platform has switched off stops being a place you can book,
  // check into or pay — before the waiver gate, which is a formality by
  // comparison. The member-facing Server Actions refuse independently
  // (lib/actions/renew.ts, member-billing.ts, checkin.ts): a layout is chrome,
  // and chrome does not run for a Server Action invocation.
  if (isOfflineGym(gym)) return <SuspendedWall gymName={gym.name} audience="member" />;

  const profile = await getProfile();
  const brand = (gym as { brand_color?: string | null }).brand_color;
  const style: CSSProperties | undefined = brand
    ? ({
        '--gf-brand': brand,
        '--gf-brand-dark': brand,
        '--gf-brand-soft': `color-mix(in srgb, ${brand} 12%, transparent)`,
        '--gf-brand-glow': `color-mix(in srgb, ${brand} 30%, transparent)`,
      } as CSSProperties)
    : undefined;

  if (!profile?.waiver_signed_at) {
    return (
      <div className="ds-member" style={style}>
        <main id="main-content"><WaiverWall gymName={gym.name} /></main>
      </div>
    );
  }

  return (
    <div className="ds-member" style={style}>
      <main id="main-content">{children}</main>
      <MemberTabBar />
      <CameraPrime />
    </div>
  );
}

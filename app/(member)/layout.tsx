import type { CSSProperties } from 'react';
import { MemberTabBar } from '@/components/member/tabbar';
import { CameraPrime } from '@/components/member/camera-prime';
import { requireMember } from '@/lib/auth/dal';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Member PWA shell — the .ds-member wrapper scopes the member design system
// and provides the mobile app frame + bottom tab bar. requireMember() gates the
// group and resolves the gym, whose accent colour (if set) re-tints the brand
// tokens across the member app.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { gym } = await requireMember();
  const brand = (gym as { brand_color?: string | null }).brand_color;
  const style: CSSProperties | undefined = brand
    ? ({
        '--gf-brand': brand,
        '--gf-brand-dark': brand,
        '--gf-brand-soft': `color-mix(in srgb, ${brand} 12%, transparent)`,
        '--gf-brand-glow': `color-mix(in srgb, ${brand} 30%, transparent)`,
      } as CSSProperties)
    : undefined;
  return (
    <div className="ds-member" style={style}>
      {children}
      <MemberTabBar />
      <CameraPrime />
    </div>
  );
}

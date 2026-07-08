import { Suspense } from 'react';
import { MemberTabBar } from '@/components/member/tabbar';
import { CameraPrime } from '@/components/member/camera-prime';
import { requireMember } from '@/lib/auth/dal';

// See app/(admin)/layout.tsx — headroom for a resuming Supabase project.
export const maxDuration = 60;

// Authenticated member PWA — keep out of search indexes.
export const metadata = { robots: { index: false, follow: false } };

// Async half of the shell: resolves the member's gym and re-tints the brand
// tokens when the gym set a custom accent. Streams inside <Suspense> so the
// static shell (tab bar + the page's loading skeleton) paints immediately
// instead of blocking every navigation and cold load on the auth round trip.
// It still calls requireMember() as defence-in-depth; each page enforces its
// own gate too (that ordering is what makes the non-blocking shell safe).
// CameraPrime lives here rather than in the sync shell so its one-shot camera
// permission prompt can never fire for a signed-out visitor mid-redirect.
async function MemberChrome() {
  const { gym } = await requireMember();
  const brand = (gym as { brand_color?: string | null }).brand_color;
  // Strict hex check — this value lands inside a <style> tag, so never emit
  // anything that isn't a plain colour literal.
  const valid = brand && /^#[0-9a-fA-F]{3,8}$/.test(brand);
  return (
    <>
      {valid && (
        <style>{`.ds-member{--gf-brand:${brand};--gf-brand-dark:${brand};--gf-brand-soft:color-mix(in srgb, ${brand} 12%, transparent);--gf-brand-glow:color-mix(in srgb, ${brand} 30%, transparent);}`}</style>
      )}
      <CameraPrime />
    </>
  );
}

// Member PWA shell — the .ds-member wrapper scopes the member design system
// and provides the mobile app frame + bottom tab bar. Deliberately synchronous:
// the gate + gym accent stream in via <MemberChrome> while the frame is already
// on screen. Known tradeoff: gyms with a custom brand_color briefly paint the
// default accent on cold loads until the tint streams in.
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-member">
      <Suspense fallback={null}>
        <MemberChrome />
      </Suspense>
      <main id="main-content">{children}</main>
      <MemberTabBar />
    </div>
  );
}

import { MemberTabBar } from '@/components/member/tabbar';

// Member PWA shell — the .ds-member wrapper scopes the member design system
// (member.css, namespaced) and provides the mobile app frame + bottom tab bar.
// Every member route renders a single <section className="view on">.
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-member">
      {children}
      <MemberTabBar />
    </div>
  );
}

import { MemberTabBar } from '@/components/ui/portal-nav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="gf-has-tabbar">
      {children}
      <MemberTabBar />
    </div>
  );
}

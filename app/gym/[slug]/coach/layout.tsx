import { CoachTabBar } from '@/components/ui/portal-nav';

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="gf-has-tabbar">
      {children}
      <CoachTabBar />
    </div>
  );
}

import '@/app/admin.css';

import { CoachTabBar } from '@/components/ui/portal-nav';

// Coach pages share the .ds-admin namespace with admin + superadmin because
// the instructor prototype uses the same KPI/panel/grid/.naira primitives
// (revamp/instructor.html inline <style>). Coach-specific widgets — today
// timeline (.tl-*), client rows (.cl-row), micro earnings chart (.ec*),
// payout card (.payout) — are also defined under .ds-admin in app/admin.css.
export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="gf-has-tabbar ds-admin">
      {children}
      <CoachTabBar />
    </div>
  );
}

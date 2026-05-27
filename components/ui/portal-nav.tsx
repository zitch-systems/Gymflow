'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Home, CalendarDays, ScanLine, GraduationCap, CreditCard,
  LayoutGrid, Users, ClipboardCheck, Wallet,
} from 'lucide-react';

type Tab = { href: string; label: string; icon: LucideIcon; fab?: boolean };

const MEMBER_TABS: Tab[] = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/classes', label: 'Classes', icon: CalendarDays },
  { href: '/checkin', label: 'Check In', icon: ScanLine, fab: true },
  { href: '/dashboard/instructors', label: 'Coaches', icon: GraduationCap },
  { href: '/dashboard/renew', label: 'Renew', icon: CreditCard },
];

const COACH_TABS: Tab[] = [
  { href: '/coach', label: 'Home', icon: LayoutGrid },
  { href: '/coach/clients', label: 'Clients', icon: Users },
  { href: '/coach/attendance', label: 'Attendance', icon: ClipboardCheck, fab: true },
  { href: '/coach/timetable', label: 'Schedule', icon: CalendarDays },
  { href: '/coach/earnings', label: 'Earnings', icon: Wallet },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // Match the user-facing path regardless of the proxy's /gym/[slug] rewrite.
  return pathname === href || pathname.endsWith(href);
}

function TabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  return (
    <nav className="gf-mobile-nav" aria-label="Primary">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = isActive(pathname, tab.href);
        if (tab.fab) {
          return (
            <Link key={tab.href} href={tab.href} className="gf-nav-tab-fab" aria-label={tab.label}>
              <span className="gf-nav-fab-ring">
                <Icon />
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        }
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`gf-nav-tab${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MemberTabBar() {
  return <TabBar tabs={MEMBER_TABS} />;
}

export function CoachTabBar() {
  return <TabBar tabs={COACH_TABS} />;
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Home, CalendarDays, ScanLine, GraduationCap, CreditCard,
  LayoutGrid, Users, ClipboardCheck, Wallet, UserCircle2, Settings,
} from 'lucide-react';
import { CommandPalette, type CommandItem } from '@/components/ui/command-palette';

type Tab = { href: string; label: string; icon: LucideIcon; fab?: boolean };

// ⌘K dataset for the portal — every tab + a couple of secondary destinations
// the bottom-tab-bar doesn't surface so members/coaches still get there in
// 2 keystrokes on desktop / iPad with a keyboard.
function tabsToCmdItems(tabs: Tab[], extras: CommandItem[] = []): CommandItem[] {
  return [
    ...tabs.map((t) => ({ href: t.href, label: t.label, icon: t.icon, hint: 'Tab' })),
    ...extras,
  ];
}

const MEMBER_TABS: Tab[] = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/classes', label: 'Classes', icon: CalendarDays },
  { href: '/checkin', label: 'Check In', icon: ScanLine, fab: true },
  { href: '/dashboard/instructors', label: 'Coaches', icon: GraduationCap },
  { href: '/dashboard/renew', label: 'Renew', icon: CreditCard },
  { href: '/dashboard/profile', label: 'Settings', icon: Settings },
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

const MEMBER_EXTRAS: CommandItem[] = [
  // Settings/profile is now a primary tab, so it's not duplicated here.
  { href: '/dashboard/cards', label: 'Saved cards', icon: CreditCard, hint: 'Page' },
];

const COACH_EXTRAS: CommandItem[] = [
  { href: '/coach/profile', label: 'Profile', icon: UserCircle2, hint: 'Page' },
];

export function MemberTabBar() {
  return (
    <>
      <CommandPalette
        items={tabsToCmdItems(MEMBER_TABS, MEMBER_EXTRAS)}
        placeholder="Jump to…  (try Classes, Coaches, Renew)"
        listLabel="Member pages"
      />
      <TabBar tabs={MEMBER_TABS} />
    </>
  );
}

export function CoachTabBar() {
  return (
    <>
      <CommandPalette
        items={tabsToCmdItems(COACH_TABS, COACH_EXTRAS)}
        placeholder="Jump to…  (try Clients, Schedule, Earnings)"
        listLabel="Coach pages"
      />
      <TabBar tabs={COACH_TABS} />
    </>
  );
}

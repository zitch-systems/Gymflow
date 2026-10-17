'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ScanLine, CalendarDays, Wallet, User } from 'lucide-react';

const TABS = [
  { href: '/dashboard', label: 'Home', icon: Home, match: (p: string) => p === '/dashboard' },
  { href: '/checkin', label: 'Check in', icon: ScanLine, match: (p: string) => p.startsWith('/checkin') },
  { href: '/classes', label: 'Classes', icon: CalendarDays, match: (p: string) => p.startsWith('/classes') },
  { href: '/dashboard/wallet', label: 'Wallet', icon: Wallet, match: (p: string) => p.startsWith('/dashboard/wallet') || p.startsWith('/dashboard/renew') },
  { href: '/dashboard/profile', label: 'Profile', icon: User, match: (p: string) => p.startsWith('/dashboard/profile') || p.startsWith('/dashboard/inbox') || p.startsWith('/dashboard/documents') },
] as const;

export function MemberTabBar() {
  const pathname = usePathname() ?? '/dashboard';
  return (
    <nav className="tabbar" aria-label="Member navigation">
      {TABS.map(({ href, label, icon: Icon, match }) => (
        <Link key={href} href={href} className={match(pathname) ? 'on' : undefined} aria-current={match(pathname) ? 'page' : undefined} style={{ textDecoration: 'none' }}>
          <Icon strokeWidth={1.9} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

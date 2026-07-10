'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, CalendarDays, ScanLine, Wallet, User } from 'lucide-react';

const TABS = [
  { href: '/dashboard', label: 'Home', icon: Home, match: (p: string) => p === '/dashboard' },
  { href: '/classes', label: 'Schedule', icon: CalendarDays, match: (p: string) => p.startsWith('/classes') },
  { href: '/checkin', label: 'Check in/out', icon: ScanLine, match: (p: string) => p.startsWith('/checkin') },
  { href: '/dashboard/wallet', label: 'Wallet', icon: Wallet, match: (p: string) => p.startsWith('/dashboard/wallet') || p.startsWith('/dashboard/renew') },
  { href: '/dashboard/profile', label: 'Profile', icon: User, match: (p: string) => p.startsWith('/dashboard/profile') || p.startsWith('/dashboard/inbox') },
] as const;

// Bottom tab bar — recreates revamp/member.html .tabbar. Active state is
// path-derived so it survives refresh/deep-link (the prototype toggled it in JS).
export function MemberTabBar() {
  const pathname = usePathname() ?? '/dashboard';
  return (
    <nav className="tabbar" aria-label="Member navigation">
      {TABS.map(({ href, label, icon: Icon, match }) => (
        <Link
          key={href}
          href={href}
          className={match(pathname) ? 'on' : undefined}
          aria-current={match(pathname) ? 'page' : undefined}
          style={{ textDecoration: 'none' }}
        >
          <Icon strokeWidth={1.9} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

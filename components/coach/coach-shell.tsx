'use client';

import type { Route } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  CalendarCheck, CalendarDays, Users, ClipboardCheck, Wallet, Banknote, Settings, LogOut, Bell,
} from 'lucide-react';

const NAV: { href: Route; label: string; icon: LucideIcon }[] = [
  { href: '/coach', label: 'Today', icon: CalendarCheck },
  { href: '/coach/classes', label: 'Classes', icon: CalendarDays },
  { href: '/coach/clients', label: 'Clients', icon: Users },
  { href: '/coach/attendance', label: 'Attendance', icon: ClipboardCheck },
  { href: '/coach/earnings', label: 'Earnings', icon: Wallet },
  { href: '/coach/payouts', label: 'Payouts', icon: Banknote },
  { href: '/coach/settings', label: 'Settings', icon: Settings },
];

export function CoachShell({ children, gymName, userName, userInitial, sharePct }: {
  children: React.ReactNode; gymName: string; userName: string; userInitial: string; sharePct: number | null;
}) {
  const pathname = usePathname() ?? '';
  const isActive = (href: string) => (href === '/coach' ? pathname === '/coach' : pathname.startsWith(href));

  return (
    <div className="ds-admin app">
      <aside className="gf-sidebar">
        <div className="gf-sidebar-header">
          <Link className="brand" href="/" style={{ textDecoration: 'none' }}>
            <Image src="/images/logomark-v3.svg" alt="" width={28} height={28} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>
          <div className="sb-role">
            <span className="gf-avatar gf-avatar-sm">{userInitial}</span>
            <div style={{ minWidth: 0 }}>
              <strong>{userName}</strong>
              <small>Instructor · {gymName}</small>
            </div>
          </div>
        </div>
        <nav className="gf-sidebar-nav">
          <span className="gf-sidebar-section">Coaching</span>
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className={`gf-nav-item${isActive(n.href) ? ' active' : ''}`}>
                <Icon size={17} strokeWidth={1.75} /><span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="gf-sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-accent-soft)', color: 'var(--gf-accent-dark)' }}>{userInitial}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.8125rem', fontWeight: 600 }}>{userName}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--gf-text-muted)' }}>{sharePct != null ? `${sharePct}% revenue share` : 'Instructor'}</div>
            </div>
            <form action={signOut}>
              <button type="submit" className="icon-btn" style={{ width: 32, height: 32 }} title="Sign out" aria-label="Sign out">
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <span className="gf-topbar-title" style={{ fontFamily: 'var(--gf-font-display)' }}>Instructor portal</span>
          <div className="top-spacer" />
          <ThemeToggle />
          <button className="icon-btn bell" title="Notifications" aria-label="Notifications"><Bell strokeWidth={1.75} /></button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

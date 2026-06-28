'use client';

import type { Route } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  LayoutDashboard, Building2, Users, TrendingUp, UserPlus, ScrollText, LifeBuoy, Settings, LogOut, Globe,
} from 'lucide-react';

const NAV: { href: Route; label: string; icon: LucideIcon; section: 'Platform' | 'Operations' }[] = [
  { href: '/superadmin', label: 'Overview', icon: LayoutDashboard, section: 'Platform' },
  { href: '/superadmin/gyms', label: 'Gyms', icon: Building2, section: 'Platform' },
  { href: '/superadmin/members', label: 'Members', icon: Users, section: 'Platform' },
  { href: '/superadmin/revenue', label: 'Revenue', icon: TrendingUp, section: 'Platform' },
  { href: '/superadmin/onboard', label: 'Onboard', icon: UserPlus, section: 'Operations' },
  { href: '/superadmin/audit', label: 'Audit log', icon: ScrollText, section: 'Operations' },
  { href: '/superadmin/support', label: 'Support', icon: LifeBuoy, section: 'Operations' },
  { href: '/superadmin/settings', label: 'Settings', icon: Settings, section: 'Operations' },
];

export function SuperShell({ children, userName, userEmail, userInitial }: {
  children: React.ReactNode; userName: string; userEmail: string; userInitial: string;
}) {
  const pathname = usePathname() ?? '';
  const isActive = (href: string) => (href === '/superadmin' ? pathname === '/superadmin' : pathname.startsWith(href));
  const platform = NAV.filter((n) => n.section === 'Platform');
  const ops = NAV.filter((n) => n.section === 'Operations');

  const link = (n: typeof NAV[number]) => {
    const Icon = n.icon;
    return (
      <Link key={n.href} href={n.href} className={`gf-nav-item${isActive(n.href) ? ' active' : ''}`}>
        <Icon size={17} strokeWidth={1.75} /><span>{n.label}</span>
      </Link>
    );
  };

  return (
    <div className="ds-admin app">
      <aside className="gf-sidebar">
        <div className="gf-sidebar-header">
          <Link className="brand" href="/" style={{ textDecoration: 'none' }}>
            <Image src="/images/logomark-v3.svg" alt="" width={28} height={28} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>
          <div className="sb-role">
            <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}><Globe size={15} strokeWidth={1.9} /></span>
            <div style={{ minWidth: 0 }}>
              <strong>Platform admin</strong>
              <small>GymFlow HQ</small>
            </div>
          </div>
        </div>
        <nav className="gf-sidebar-nav">
          <span className="gf-sidebar-section">Platform</span>
          {platform.map(link)}
          <span className="gf-sidebar-section">Operations</span>
          {ops.map(link)}
        </nav>
        <div className="gf-sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-info-soft)', color: 'var(--gf-info)' }}>{userInitial}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.8125rem', fontWeight: 600 }}>{userName}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--gf-text-muted)' }}>{userEmail}</div>
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
          <span className="gf-topbar-title" style={{ fontFamily: 'var(--gf-font-display)' }}>Platform console</span>
          <div className="top-spacer" />
          <ThemeToggle />
          <span className="pill-plat"><Globe size={12} strokeWidth={2} /> Superadmin</span>
        </header>
        <main id="main-content" className="content">{children}</main>
      </div>
    </div>
  );
}

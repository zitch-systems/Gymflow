'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Users, ShieldCheck, Building2, LogOut, Menu } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';

type NavItem = { href: string; label: string; icon: LucideIcon };

// Only routes that exist today. Revenue / Support / Settings / a Gyms list are
// added here as those pages land — keeping the nav free of dead links.
const NAV: NavItem[] = [
  { href: '/superadmin', label: 'Overview', icon: LayoutDashboard },
  { href: '/superadmin/members', label: 'Members', icon: Users },
  { href: '/superadmin/audit', label: 'Audit', icon: ShieldCheck },
  { href: '/superadmin/gyms/new', label: 'Onboard gym', icon: Building2 },
];

export function SuperadminShell({
  children,
  userName,
  userInitial,
}: {
  children: React.ReactNode;
  userName: string;
  userInitial: string;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/superadmin'
      ? pathname === '/superadmin' || pathname.endsWith('/superadmin')
      : pathname.includes(href);

  return (
    <>
      <div className={`gf-sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`gf-sidebar${open ? ' open' : ''}`}>
        <div className="gf-sidebar-header">
          <Link href="/superadmin" className="gf-logo gf-logo-sm">
            <LogoMark />
            <span className="gf-logo-text">Gym<em>Flow</em></span>
          </Link>
          <div className="gf-sidebar-gym-name">Platform admin</div>
        </div>

        <nav className="gf-sidebar-nav">
          <span className="gf-sidebar-section">Platform</span>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`gf-nav-item${isActive(item.href) ? ' active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Icon size={17} strokeWidth={1.75} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="gf-sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
                {userInitial}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gf-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {userName}
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--gf-text-muted)', fontWeight: 500 }}>Superadmin</div>
              </div>
            </div>
            <form action={signOut}>
              <button type="submit" className="gf-btn-icon gf-btn-ghost" title="Sign out" aria-label="Sign out">
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="gf-main">
        <header className="gf-topbar">
          <button
            type="button"
            className="gf-btn-icon gf-btn-ghost"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>
          <span className="gf-topbar-title">Platform</span>
          <span style={{ flex: 1 }} />
          <span className="gf-badge gf-badge-brand">Superadmin</span>
        </header>
        {children}
      </div>

      <nav className="gf-admin-tabbar" aria-label="Primary">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`gf-nav-tab${isActive(href) ? ' active' : ''}`}
            aria-current={isActive(href) ? 'page' : undefined}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

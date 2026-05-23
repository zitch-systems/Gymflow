'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '@/lib/auth/actions';

type NavItem = { href: string; label: string; section: 'main' | 'admin' };

const NAV: NavItem[] = [
  { href: '/admin/dashboard', label: 'Members', section: 'main' },
  { href: '/admin/staff-checkin', label: 'Check-In', section: 'main' },
  { href: '/admin/analytics', label: 'Analytics', section: 'main' },
  { href: '/admin/classes', label: 'Classes', section: 'main' },
  { href: '/admin/pricing', label: 'Pricing', section: 'admin' },
  { href: '/admin/reminders', label: 'Reminders', section: 'admin' },
  { href: '/admin/operations', label: 'Operations', section: 'admin' },
  { href: '/admin/business-hours', label: 'Hours', section: 'admin' },
  { href: '/admin/waiver', label: 'Waiver', section: 'admin' },
  { href: '/admin/settings', label: 'Settings', section: 'admin' },
];

export function AdminShell({
  children,
  gymName,
  role,
  userName,
  userInitial,
}: {
  children: React.ReactNode;
  gymName: string;
  role: string;
  userName: string;
  userInitial: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname?.endsWith(href);
  const mainItems = NAV.filter((i) => i.section === 'main');
  const adminItems = NAV.filter((i) => i.section === 'admin');

  return (
    <>
      <div className={`gf-sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`gf-sidebar${open ? ' open' : ''}`}>
        <div className="gf-sidebar-header">
          <Link href="/admin/dashboard" className="gf-logo gf-logo-sm">
            <span className="gf-logo-mark">
              <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="8" width="5" height="8" rx="1.5" />
                <rect x="1" y="10.5" width="7" height="3" rx="1" />
                <rect x="17" y="8" width="5" height="8" rx="1.5" />
                <rect x="16" y="10.5" width="7" height="3" rx="1" />
                <rect x="10.5" y="5" width="3" height="14" rx="1.5" />
              </svg>
            </span>
            <span className="gf-logo-text">
              Gym<em>Flow</em>
            </span>
          </Link>
          <div className="gf-sidebar-gym-name">{gymName}</div>
        </div>

        <nav className="gf-sidebar-nav">
          <span className="gf-sidebar-section">Main</span>
          {mainItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`gf-nav-item${isActive(item.href) ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}

          <span className="gf-sidebar-section">Admin</span>
          {adminItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`gf-nav-item${isActive(item.href) ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
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
                <div style={{ fontSize: '0.6875rem', color: 'var(--gf-text-muted)', fontWeight: 500 }}>{role}</div>
              </div>
            </div>
            <form action={signOut}>
              <button type="submit" className="gf-btn-icon gf-btn-ghost" title="Sign out" aria-label="Sign out">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="gf-main">
        <header className="gf-topbar">
          <button
            type="button"
            id="hamburger"
            className="gf-btn-icon gf-btn-ghost"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="gf-topbar-title">{gymName}</span>
        </header>
        {children}
      </div>
    </>
  );
}

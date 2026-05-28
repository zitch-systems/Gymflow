'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Users, ScanLine, BarChart3, CalendarDays, GraduationCap,
  Tag, Bell, Wrench, Clock, FileText, ShieldCheck, Wallet, Settings,
  LogOut, Menu, CreditCard,
} from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';
import { CommandPalette, type CommandItem } from './command-palette';

type NavItem = { href: string; label: string; section: 'main' | 'admin'; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: '/admin/dashboard',     label: 'Members',    section: 'main',  icon: Users },
  { href: '/admin/staff-checkin', label: 'Check-In',   section: 'main',  icon: ScanLine },
  { href: '/admin/analytics',     label: 'Analytics',  section: 'main',  icon: BarChart3 },
  { href: '/admin/classes',       label: 'Classes',    section: 'main',  icon: CalendarDays },
  { href: '/admin/instructors',   label: 'Instructors',section: 'main',  icon: GraduationCap },
  { href: '/admin/pricing',       label: 'Pricing',    section: 'admin', icon: Tag },
  { href: '/admin/reminders',     label: 'Reminders',  section: 'admin', icon: Bell },
  { href: '/admin/operations',    label: 'Operations', section: 'admin', icon: Wrench },
  { href: '/admin/business-hours',label: 'Hours',      section: 'admin', icon: Clock },
  { href: '/admin/waiver',        label: 'Waiver',     section: 'admin', icon: FileText },
  { href: '/admin/audit',         label: 'Audit',      section: 'admin', icon: ShieldCheck },
  { href: '/admin/wallet',        label: 'Wallet',     section: 'admin', icon: Wallet },
  { href: '/admin/billing',       label: 'Billing',    section: 'admin', icon: CreditCard },
  { href: '/admin/settings',      label: 'Settings',   section: 'admin', icon: Settings },
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

  // Reuse the nav array as the command-palette dataset — every page is
  // already in NAV, so ⌘K and the sidebar can't drift out of sync.
  const cmdItems: CommandItem[] = NAV.map((i) => ({
    href: i.href,
    label: i.label,
    icon: i.icon,
    hint: i.section === 'main' ? 'Main' : 'Admin',
  }));

  return (
    <>
      <CommandPalette items={cmdItems} />
      <div className={`gf-sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`gf-sidebar${open ? ' open' : ''}`}>
        <div className="gf-sidebar-header">
          <Link href="/admin/dashboard" className="gf-logo gf-logo-sm">
            <LogoMark />
            <span className="gf-logo-text">
              Gym<em>Flow</em>
            </span>
          </Link>
          <div className="gf-sidebar-gym-name">{gymName}</div>
        </div>

        <nav className="gf-sidebar-nav">
          <span className="gf-sidebar-section">Main</span>
          {mainItems.map((item) => {
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

          <span className="gf-sidebar-section">Admin</span>
          {adminItems.map((item) => {
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
                <div style={{ fontSize: '0.6875rem', color: 'var(--gf-text-muted)', fontWeight: 500 }}>{role}</div>
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
            id="hamburger"
            className="gf-btn-icon gf-btn-ghost"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>
          <span className="gf-topbar-title">{gymName}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="gf-topbar-cmdk"
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            aria-label="Open command palette"
            title="Jump to any page (⌘K)"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>Jump to&hellip;</span>
              <kbd>⌘K</kbd>
            </span>
          </button>
        </header>
        {children}
      </div>
    </>
  );
}

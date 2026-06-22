'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  LayoutDashboard, Users, ScanLine, BarChart3, CalendarDays,
  GraduationCap, Tag, Bell, Wrench, Wallet, Settings, LogOut, Search, CreditCard, QrCode,
} from 'lucide-react';

type Item = { href: string; label: string; icon: LucideIcon; section: 'Main' | 'Admin' };

// Sidebar nav — order + labels from revamp/admin.html (Overview · Members ·
// Check-In · Analytics · Classes · Staff | Pricing · Reminders · Facility ·
// Wallet · Settings). Route slugs match the (admin)/admin/* tree.
const NAV: Item[] = [
  { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard, section: 'Main' },
  { href: '/admin/members', label: 'Members', icon: Users, section: 'Main' },
  { href: '/admin/invite', label: 'Invite QR', icon: QrCode, section: 'Main' },
  { href: '/admin/staff-checkin', label: 'Check-In', icon: ScanLine, section: 'Main' },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3, section: 'Main' },
  { href: '/admin/classes', label: 'Classes', icon: CalendarDays, section: 'Main' },
  { href: '/admin/instructors', label: 'Staff', icon: GraduationCap, section: 'Main' },
  { href: '/admin/pricing', label: 'Pricing', icon: Tag, section: 'Admin' },
  { href: '/admin/reminders', label: 'Reminders', icon: Bell, section: 'Admin' },
  { href: '/admin/operations', label: 'Facility', icon: Wrench, section: 'Admin' },
  { href: '/admin/wallet', label: 'Wallet', icon: Wallet, section: 'Admin' },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard, section: 'Admin' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, section: 'Admin' },
];

type Identity = {
  gymName: string; gymMeta: string; gymInitial: string;
  userName: string; userRole: string; userInitial: string;
};

export function AdminShell({ children, gymName, gymMeta, gymInitial, userName, userRole, userInitial }: { children: React.ReactNode } & Identity) {
  const pathname = usePathname() ?? '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const main = NAV.filter((n) => n.section === 'Main');
  const admin = NAV.filter((n) => n.section === 'Admin');

  const navLink = (n: Item) => {
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
          <div className="sb-gym">
            <span className="gf-avatar gf-avatar-sm">{gymInitial}</span>
            <div style={{ minWidth: 0 }}>
              <strong>{gymName}</strong>
              <small>{gymMeta}</small>
            </div>
          </div>
        </div>
        <nav className="gf-sidebar-nav">
          <span className="gf-sidebar-section">Main</span>
          {main.map(navLink)}
          <span className="gf-sidebar-section">Admin</span>
          {admin.map(navLink)}
        </nav>
        <div className="gf-sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>{userInitial}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.8125rem', fontWeight: 600 }}>{userName}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--gf-text-muted)' }}>{userRole}</div>
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
          <div className="search" style={{ flex: 1, maxWidth: 460 }}>
            <Search strokeWidth={1.75} />
            <input placeholder="Search members, classes, payments…" aria-label="Search" />
          </div>
          <div className="top-spacer" />
          <ThemeToggle />
          <Link href="/admin/members" className="icon-btn bell" title="Notifications" aria-label="Notifications"><Bell strokeWidth={1.75} /></Link>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

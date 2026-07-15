'use client';

import type { Route } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import { GymSwitcher } from '@/components/gym-switcher';
import { useMobileNav, NavBurger, NavBackdrop } from '@/components/mobile-nav';
import {
  LayoutDashboard, Users, ScanLine, BarChart3, CalendarDays,
  GraduationCap, Tag, Bell, Wrench, Wallet, Settings, LogOut, Search, CreditCard, QrCode,
} from 'lucide-react';

// `roles`, when set, limits the nav item to those staff roles. Owners/managers
// see everything (they're a superset). Unrestricted items show for all admin
// staff (front desk, accountant included). This mirrors the role gates on the
// underlying pages/actions — it's the visible half of the RBAC alignment.
//
// Reminders and Wallet are unrestricted: requireStaff() on both pages (and
// the RLS policies behind member_subscriptions/reminder_logs/payments) already
// grant every admin-console role — including front desk — full read/send
// access, since nudging members about renewals and checking a payment's
// status at the desk are front-desk tasks. Keep this list in sync with those
// gates rather than narrowing it here only.
type Item = { href: Route; label: string; icon: LucideIcon; section: 'Main' | 'Admin'; roles?: readonly string[] };

const MANAGER = ['gym_owner', 'owner', 'manager'] as const;
const FINANCE = ['gym_owner', 'owner', 'manager', 'accountant'] as const;

// Sidebar nav — order + labels from revamp/admin.html (Overview · Members ·
// Check-In · Analytics · Classes · Staff | Pricing · Reminders · Facility ·
// Wallet · Settings). Route slugs match the (admin)/admin/* tree.
const NAV: Item[] = [
  { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard, section: 'Main' },
  { href: '/admin/members', label: 'Members', icon: Users, section: 'Main' },
  { href: '/admin/invite', label: 'Invite QR', icon: QrCode, section: 'Main' },
  { href: '/admin/staff-checkin', label: 'Check-in/out', icon: ScanLine, section: 'Main' },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3, section: 'Main', roles: FINANCE },
  { href: '/admin/classes', label: 'Classes', icon: CalendarDays, section: 'Main' },
  { href: '/admin/instructors', label: 'Staff', icon: GraduationCap, section: 'Main', roles: MANAGER },
  { href: '/admin/pricing', label: 'Pricing', icon: Tag, section: 'Admin', roles: MANAGER },
  { href: '/admin/reminders', label: 'Reminders', icon: Bell, section: 'Admin' },
  { href: '/admin/operations', label: 'Facility', icon: Wrench, section: 'Admin' },
  { href: '/admin/wallet', label: 'Wallet', icon: Wallet, section: 'Admin' },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard, section: 'Admin', roles: FINANCE },
  { href: '/admin/settings', label: 'Settings', icon: Settings, section: 'Admin', roles: MANAGER },
];

type Identity = {
  gymName: string; gymMeta: string; gymInitial: string;
  userName: string; userRole: string; userInitial: string; roleKey?: string;
  gyms?: { id: string; name: string }[]; activeGymId?: string;
  pendingFreezes?: number;
};

export function AdminShell({ children, gymName, gymMeta, gymInitial, userName, userRole, userInitial, roleKey = '', gyms = [], activeGymId = '', pendingFreezes = 0 }: { children: React.ReactNode } & Identity) {
  const pathname = usePathname() ?? '';
  const nav = useMobileNav(pathname);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const canSee = (n: Item) => !n.roles || n.roles.includes(roleKey);
  const main = NAV.filter((n) => n.section === 'Main' && canSee(n));
  const admin = NAV.filter((n) => n.section === 'Admin' && canSee(n));

  // Sidebar per-item counter (freeze requests on Members today; more surfaces
  // can plug in here). Rendered as a small warning pill so staff can see there
  // is something waiting without opening the tab.
  const badgeFor = (href: string): number => href === '/admin/members' ? pendingFreezes : 0;

  const navLink = (n: Item) => {
    const Icon = n.icon;
    const count = badgeFor(n.href);
    return (
      <Link key={n.href} href={n.href} className={`gf-nav-item${isActive(n.href) ? ' active' : ''}`}>
        <Icon size={17} strokeWidth={1.75} /><span>{n.label}</span>
        {count > 0 && (
          <span
            className="gf-badge gf-badge-warning"
            style={{ marginLeft: 'auto', padding: '2px 7px', fontSize: '0.7rem', minWidth: 20, textAlign: 'center' }}
            aria-label={`${count} pending`}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className={`ds-admin app${nav.open ? ' nav-open' : ''}`}>
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
          <GymSwitcher gyms={gyms} activeId={activeGymId} redirectTo="/admin/dashboard" />
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

      <NavBackdrop open={nav.open} onClose={nav.close} />

      <div className="main">
        <header className="top">
          <NavBurger open={nav.open} onClick={nav.toggle} />
          <div className="search" style={{ flex: 1, maxWidth: 460 }}>
            <Search strokeWidth={1.75} />
            <input placeholder="Search members, classes, payments…" aria-label="Search" />
          </div>
          <div className="top-spacer" />
          <ThemeToggle />
          <Link href="/admin/members" className="icon-btn bell" title="Notifications" aria-label="Notifications"><Bell strokeWidth={1.75} /></Link>
        </header>
        <main id="main-content" className="content">{children}</main>
      </div>
    </div>
  );
}

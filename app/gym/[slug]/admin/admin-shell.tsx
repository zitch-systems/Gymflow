'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Users, ScanLine, BarChart3, CalendarDays, GraduationCap,
  Tag, Bell, Wrench, Wallet, Settings, LayoutDashboard,
  LogOut, Menu,
} from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { LogoMark } from '@/components/ui/logo';
import { CommandPalette, type CommandItem, type CommandSearchHit } from '@/components/ui/command-palette';
import { searchMembers } from '@/lib/actions/search-members';

type NavItem = { href: string; label: string; section: 'main' | 'admin'; icon: LucideIcon };

// Matches the prototype's admin surfaces 1:1 (revamp/admin*.html). Routes
// outside this list — announcements / audit / billing / business-hours /
// payouts / pt-packs / waiver — were cut as part of the platform rewrite.
// Order + labels mirror revamp/admin-mobile.html and the desktop prototype's
// sidebar. /admin/dashboard is the "Overview" page; /admin/members is the
// dedicated members table. Route slugs (instructors / operations) stay as
// they are — only the displayed labels match the prototype (Staff / Facility).
const NAV: NavItem[] = [
  { href: '/admin/dashboard',     label: 'Overview',    section: 'main',  icon: LayoutDashboard },
  { href: '/admin/members',       label: 'Members',     section: 'main',  icon: Users },
  { href: '/admin/staff-checkin', label: 'Check-In',    section: 'main',  icon: ScanLine },
  { href: '/admin/analytics',     label: 'Analytics',   section: 'main',  icon: BarChart3 },
  { href: '/admin/classes',       label: 'Classes',     section: 'main',  icon: CalendarDays },
  { href: '/admin/instructors',   label: 'Staff',       section: 'main',  icon: GraduationCap },
  { href: '/admin/pricing',       label: 'Pricing',     section: 'admin', icon: Tag },
  { href: '/admin/reminders',     label: 'Reminders',   section: 'admin', icon: Bell },
  { href: '/admin/operations',    label: 'Facility',    section: 'admin', icon: Wrench },
  { href: '/admin/wallet',        label: 'Wallet',      section: 'admin', icon: Wallet },
  { href: '/admin/settings',      label: 'Settings',    section: 'admin', icon: Settings },
];

export function AdminShell({
  children,
  slug,
  gymName,
  role,
  userName,
  userInitial,
}: {
  children: React.ReactNode;
  slug: string;
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

  // Live member search — fires on every keystroke (debounced inside the
  // palette) so typing "tunde" surfaces members alongside the static pages.
  // Server action does its own requireStaff(slug) gate, so even a malicious
  // client crafting the call directly would be rejected.
  const fetchExtra = async (query: string): Promise<CommandSearchHit[]> => {
    const hits = await searchMembers(slug, query);
    return hits.map((m) => ({ id: m.id, label: m.label, href: m.href, hint: m.email ?? undefined }));
  };

  return (
    <>
      <CommandPalette
        items={cmdItems}
        placeholder="Jump to a page or search a member…"
        listLabel="Admin pages and members"
        fetchExtra={fetchExtra}
        extraSectionLabel="Members"
      />
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
        {/* .ds-admin scopes every admin page's prototype-class styling
            (.page-h, .kpis, .panel, .who, .clx, .day, .balance, etc.).
            Topbar above stays out of the namespace so it keeps using .gf-*. */}
        <div className="ds-admin">{children}</div>
      </div>

      {/* Mobile bottom tab bar — app-style quick nav to the top admin
          destinations; "More" opens the full sidebar drawer. Visible only at
          ≤1024px (where the sidebar is off-canvas); hidden on desktop. */}
      <nav className="gf-admin-tabbar" aria-label="Primary">
        {([
          { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard },
          { href: '/admin/members', label: 'Members', icon: Users },
          { href: '/admin/classes', label: 'Classes', icon: CalendarDays },
          { href: '/admin/staff-checkin', label: 'Check-In', icon: ScanLine },
        ] as const).map(({ href, label, icon: Icon }) => (
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
        <button type="button" className="gf-nav-tab" onClick={() => setOpen(true)} aria-label="More menu">
          <Menu />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}

'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import { useMobileNav, NavBurger, NavBackdrop } from '@/components/mobile-nav';
import { ConsoleTabBar, type ConsoleTab } from '@/components/console-tabbar';
import {
  LayoutDashboard, Building2, Users, TrendingUp, UserPlus, ScrollText, LifeBuoy, Settings, LogOut, Globe, Banknote,
  Bot, MessageCircle,
} from 'lucide-react';
import { LogoMark } from '@/components/ui/logo';

// Sub-paths, not absolute hrefs: the console's public base is configured per
// deployment (SUPERADMIN_PATH — see lib/superadmin-path.ts) and arrives as the
// `base` prop, because a Client Component can't read server env. Hard-coding
// '/superadmin/...' here would navigate the admin to the blocked path and 404
// them out of their own console.
const NAV: { sub: string; label: string; icon: LucideIcon; section: 'Platform' | 'Operations' }[] = [
  { sub: '', label: 'Overview', icon: LayoutDashboard, section: 'Platform' },
  { sub: '/gyms', label: 'Gyms', icon: Building2, section: 'Platform' },
  { sub: '/members', label: 'Members', icon: Users, section: 'Platform' },
  { sub: '/revenue', label: 'Revenue', icon: TrendingUp, section: 'Platform' },
  // The two backends gyms switch on for themselves but cannot provision: the
  // AI catalogue ships disabled and keyless, and the WhatsApp number is shared.
  { sub: '/ai', label: 'AI providers', icon: Bot, section: 'Platform' },
  { sub: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, section: 'Platform' },
  { sub: '/onboard', label: 'Onboard', icon: UserPlus, section: 'Operations' },
  { sub: '/payout-approvals', label: 'Payout approvals', icon: Banknote, section: 'Operations' },
  { sub: '/audit', label: 'Audit log', icon: ScrollText, section: 'Operations' },
  { sub: '/support', label: 'Support', icon: LifeBuoy, section: 'Operations' },
  { sub: '/settings', label: 'Settings', icon: Settings, section: 'Operations' },
];

export function SuperShell({ children, base, userName, userEmail, userInitial }: {
  children: React.ReactNode; base: string; userName: string; userEmail: string; userInitial: string;
}) {
  // usePathname() returns what the browser shows — the secret path — not the
  // internal route the middleware rewrote to, so it lines up with `base`.
  const pathname = usePathname() ?? '';
  const nav = useMobileNav(pathname);
  const href = (sub: string) => `${base}${sub}` as Route;
  const isActive = (sub: string) => (sub === '' ? pathname === base : pathname.startsWith(`${base}${sub}`));
  const platform = NAV.filter((n) => n.section === 'Platform');
  const ops = NAV.filter((n) => n.section === 'Operations');

  const link = (n: typeof NAV[number]) => {
    const Icon = n.icon;
    return (
      <Link key={n.sub} href={href(n.sub)} className={`gf-nav-item${isActive(n.sub) ? ' active' : ''}`}>
        <Icon size={17} strokeWidth={1.75} /><span>{n.label}</span>
      </Link>
    );
  };

  return (
    <div className={`ds-admin app${nav.open ? ' nav-open' : ''}`}>
      <aside className="gf-sidebar">
        <div className="gf-sidebar-header">
          <Link className="brand" href="/" style={{ textDecoration: 'none' }}>
            <LogoMark size={28} className="mark-sm" />
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

      <NavBackdrop open={nav.open} onClose={nav.close} />

      <div className="main">
        <header className="top">
          <NavBurger open={nav.open} onClick={nav.toggle} />
          <span className="gf-topbar-title" style={{ fontFamily: 'var(--gf-font-display)' }}>Platform console</span>
          <div className="top-spacer" />
          <ThemeToggle />
          <span className="pill-plat"><Globe size={12} strokeWidth={2} /> Superadmin</span>
        </header>
        <main id="main-content" className="content">{children}</main>
      </div>

      {/* Phone bottom tabs — mirrors revamp/superadmin-mobile.html (Home ·
          Gyms · Revenue · Activity · More). */}
      <ConsoleTabBar
        tabs={[
          { href: href(''), label: 'Home', icon: LayoutDashboard, match: (p) => p === base },
          { href: href('/gyms'), label: 'Gyms', icon: Building2 },
          { href: href('/revenue'), label: 'Revenue', icon: TrendingUp },
          { href: href('/audit'), label: 'Activity', icon: ScrollText },
        ] satisfies ConsoleTab[]}
        moreOpen={nav.open}
        onMore={nav.toggle}
      />
    </div>
  );
}

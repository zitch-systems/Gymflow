'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { Menu } from 'lucide-react';

// Bottom tab bar for the console shells (admin / coach / superadmin) on
// phones — ports revamp/{admin,instructor,superadmin}-mobile.html's .tabbar
// into the app. Desktop keeps the sidebar; below 860px the sidebar becomes a
// drawer and this bar carries the 3–4 highest-traffic destinations plus a
// "More" button that opens that drawer (the drawer already holds the full,
// role-filtered nav, the gym switcher and sign-out, so every remaining route
// stays one tap away instead of needing a separate "More" page).
//
// `fab` marks the prototype's raised center action (admin: Scan → front-desk
// check-in). Active state is path-derived so it survives refresh/deep-link.
export type ConsoleTab = {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Active when the current pathname matches. Defaults to prefix match. */
  match?: (pathname: string) => boolean;
  /** Raised center action button (at most one per bar). */
  fab?: boolean;
  /** Attention dot (e.g. pending freeze requests on Members). */
  dot?: boolean;
};

export function ConsoleTabBar({ tabs, moreOpen, onMore }: {
  tabs: ConsoleTab[];
  /** Drawer open state — mirrored on the More button (aria-expanded + active tint). */
  moreOpen: boolean;
  onMore: () => void;
}) {
  const pathname = usePathname() ?? '';
  const isOn = (t: ConsoleTab) =>
    t.match ? t.match(pathname) : pathname === t.href || pathname.startsWith(t.href + '/');

  return (
    <nav className="console-tabbar" aria-label="Primary">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = isOn(t);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`${t.fab ? 'center' : ''}${on ? ' on' : ''}`}
            aria-current={on ? 'page' : undefined}
          >
            {t.fab
              ? <span className="fab"><Icon strokeWidth={2} /></span>
              : <Icon strokeWidth={1.9} />}
            {t.label}
            {t.dot && <span className="nav-dot" aria-hidden="true" />}
          </Link>
        );
      })}
      <button
        type="button"
        className={moreOpen ? 'on' : undefined}
        aria-expanded={moreOpen}
        aria-label="More navigation"
        onClick={onMore}
      >
        <Menu strokeWidth={1.9} />
        More
      </button>
    </nav>
  );
}

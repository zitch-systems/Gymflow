'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ScanLine, Wallet, User, MessageCircle } from 'lucide-react';

const TABS = [
  { href: '/dashboard', label: 'Home', icon: Home, match: (p: string) => p === '/dashboard', external: false },
  { href: '#whatsapp', label: 'WhatsApp', icon: MessageCircle, match: () => false, external: true },
  { href: '/checkin', label: 'Check in/out', icon: ScanLine, match: (p: string) => p.startsWith('/checkin'), external: false },
  { href: '/dashboard/wallet', label: 'Wallet', icon: Wallet, match: (p: string) => p.startsWith('/dashboard/wallet') || p.startsWith('/dashboard/renew'), external: false },
  { href: '/dashboard/profile', label: 'Profile', icon: User, match: (p: string) => p.startsWith('/dashboard/profile') || p.startsWith('/dashboard/inbox'), external: false },
] as const;

export function MemberTabBar({ whatsappUrl }: { whatsappUrl?: string | null }) {
  const pathname = usePathname() ?? '/dashboard';
  return (
    <nav className="tabbar" aria-label="Member navigation">
      {TABS.map(({ href, label, icon: Icon, match, external }) => {
        if (external && label === 'WhatsApp') {
          const url = whatsappUrl ?? 'https://wa.me/';
          return (
            <a
              key={href}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <Icon strokeWidth={1.9} />
              {label}
            </a>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            className={match(pathname) ? 'on' : undefined}
            aria-current={match(pathname) ? 'page' : undefined}
            style={{ textDecoration: 'none' }}
          >
            <Icon strokeWidth={1.9} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

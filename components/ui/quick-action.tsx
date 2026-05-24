import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: ReactNode;
}) {
  return (
    <Link href={href} className="gf-quick-action">
      <span className="gf-quick-action-icon" aria-hidden>
        <Icon size={22} strokeWidth={1.75} />
      </span>
      <span className="gf-quick-action-label">{label}</span>
    </Link>
  );
}

export function QuickActions({ children }: { children: ReactNode }) {
  return <section className="gf-quick-actions">{children}</section>;
}

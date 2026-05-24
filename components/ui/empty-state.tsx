import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="gf-empty">
      <div className="gf-empty-icon" aria-hidden>
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <div className="gf-empty-title">{title}</div>
      {message ? <div className="gf-empty-text">{message}</div> : null}
      {action ? <div className="gf-empty-action">{action}</div> : null}
    </div>
  );
}

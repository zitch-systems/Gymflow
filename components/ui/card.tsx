import type { ReactNode } from 'react';

export function Card({ children, className = '', padded = false }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={`gf-card ${padded ? 'gf-card-padded' : ''} ${className}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="gf-card-header">
      <div>
        <h2 className="gf-card-title">{title}</h2>
        {subtitle ? <p className="gf-card-subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="gf-card-actions">{action}</div> : null}
    </header>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`gf-card-body ${className}`}>{children}</div>;
}

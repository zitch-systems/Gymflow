import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="gf-page-header">
      <div className="gf-page-header-text">
        <h1 className="gf-page-title">{title}</h1>
        {subtitle ? <p className="gf-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="gf-page-header-actions">{actions}</div> : null}
    </header>
  );
}

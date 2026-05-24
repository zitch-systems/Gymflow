import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Accent = 'emerald' | 'blue' | 'amber' | 'purple' | 'rose' | 'slate';

export function Stat({
  label,
  value,
  icon: Icon,
  accent = 'emerald',
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  accent?: Accent;
  hint?: ReactNode;
}) {
  return (
    <div className={`gf-kpi gf-kpi-${accent}`}>
      {Icon ? (
        <div className="gf-kpi-icon" aria-hidden>
          <Icon size={20} strokeWidth={1.75} />
        </div>
      ) : null}
      <div className="gf-kpi-value">{value}</div>
      <div className="gf-kpi-label">{label}</div>
      {hint ? <div className="gf-kpi-hint">{hint}</div> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <section className="gf-kpi-grid">{children}</section>;
}

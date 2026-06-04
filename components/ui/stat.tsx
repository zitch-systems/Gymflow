import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Accent = 'emerald' | 'blue' | 'amber' | 'purple' | 'rose' | 'slate';

// Tiny inline sparkline (area + line) drawn in a 100×28 viewBox and stretched to
// the card width. `vector-effect` keeps the stroke crisp despite the non-uniform
// scale; a flat series sits on the mid-line rather than the floor.
function sparkPaths(data: number[], w = 100, h = 28, pad = 3) {
  const n = data.length;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min;
  const pts = data.map((v, i): [number, number] => {
    const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
    const y = span === 0 ? h / 2 : h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return { line, area };
}

export function Stat({
  label,
  value,
  icon: Icon,
  accent = 'emerald',
  hint,
  spark,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  accent?: Accent;
  hint?: ReactNode;
  spark?: number[];
}) {
  const paths = spark && spark.length >= 2 ? sparkPaths(spark) : null;
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
      {paths ? (
        <svg className="gf-kpi-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
          <path className="gf-kpi-spark-area" d={paths.area} />
          <path className="gf-kpi-spark-line" d={paths.line} vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <section className="gf-kpi-grid">{children}</section>;
}

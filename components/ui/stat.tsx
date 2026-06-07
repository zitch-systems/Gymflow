import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';

type Accent = 'emerald' | 'blue' | 'amber' | 'purple' | 'rose' | 'slate' | 'lime';

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

// Prototype .kpi-ic uses literal hex tints (e.g. #11d18b1f / #11d18b). Map each
// accent onto its (icon foreground, icon background-soft, spark-stroke) tuple.
// Values mirror revamp/admin*.html exactly so the live admin KPI strips look
// pixel-identical to the spec.
const ACCENT_STYLE: Record<Accent, { fg: string; bg: string; spark: string }> = {
  emerald: { fg: '#11d18b', bg: 'rgba(17, 209, 139, 0.12)', spark: '#11d18b' },
  blue:    { fg: '#4080ff', bg: 'rgba(64, 128, 255, 0.12)', spark: '#4080ff' },
  amber:   { fg: '#ffb020', bg: 'rgba(255, 176, 32, 0.12)', spark: '#ffb020' },
  purple:  { fg: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)', spark: '#8b5cf6' },
  rose:    { fg: '#ff4560', bg: 'rgba(255, 69, 96, 0.12)',  spark: '#ff4560' },
  slate:   { fg: '#9b9bb8', bg: 'rgba(155, 155, 184, 0.14)', spark: '#9b9bb8' },
  lime:    { fg: '#a8d92e', bg: 'rgba(198, 242, 78, 0.12)', spark: '#a8d92e' },
};

export type Delta = { value: string; dir: 'up' | 'down' };

export function Stat({
  label,
  value,
  icon: Icon,
  accent = 'emerald',
  hint,
  spark,
  delta,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  accent?: Accent;
  hint?: ReactNode;
  spark?: number[];
  delta?: Delta;
}) {
  const style = ACCENT_STYLE[accent];
  const paths = spark && spark.length >= 2 ? sparkPaths(spark) : null;
  const DeltaIcon = delta?.dir === 'down' ? TrendingDown : TrendingUp;
  return (
    <div className="kpi">
      <div className="kpi-top">
        {Icon ? (
          <div className="kpi-ic" style={{ background: style.bg, color: style.fg }} aria-hidden>
            <Icon strokeWidth={1.75} />
          </div>
        ) : <span />}
        {delta ? (
          <span className={`kpi-delta ${delta.dir}`}>
            <DeltaIcon strokeWidth={2} />
            {delta.value}
          </span>
        ) : null}
      </div>
      <div className="kpi-val">{value}</div>
      <div className="kpi-lbl">{label}</div>
      {hint ? <div className="kpi-lbl" style={{ marginTop: 2 }}>{hint}</div> : null}
      {paths ? (
        <svg className="kpi-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={`spark-${accent}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={style.spark} stopOpacity="0.25" />
              <stop offset="1" stopColor={style.spark} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={paths.area} fill={`url(#spark-${accent})`} />
          <path d={paths.line} fill="none" stroke={style.spark} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <section className="kpis">{children}</section>;
}

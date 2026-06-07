// Skeleton primitives — rounded shapes with a subtle shimmer. Used in
// per-route loading.tsx files instead of a bare spinner so the UI's structural
// boundaries are visible during the fetch instead of a blank centre with a
// dot. Lower perceived latency, same time-to-paint.
//
// Server component — no client interactivity, just styled boxes.

import type { CSSProperties } from 'react';

type Props = {
  /** width — number = px, string = direct CSS (e.g. '60%') */
  w?: number | string;
  /** height — number = px, string = direct CSS */
  h?: number | string;
  /** Border radius override */
  rounded?: number | string;
  /** Inline style passthrough for layout tweaks */
  style?: CSSProperties;
  /** Extra class names */
  className?: string;
};

function unit(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

export function Skeleton({ w, h = 12, rounded = 6, style, className }: Props) {
  return (
    <span
      className={`gf-skeleton${className ? ` ${className}` : ''}`}
      style={{
        width: unit(w),
        height: unit(h),
        borderRadius: unit(rounded),
        ...style,
      }}
      aria-hidden
    />
  );
}

/** Multi-line skeleton text — last line is shorter for a natural look. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={10} w={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

/** A skeleton row sized to match the gf-table tbody tr height. */
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '12px 14px' }}>
          <Skeleton h={12} w={i === 0 ? 120 : i === cols - 1 ? 60 : 90} />
        </td>
      ))}
    </tr>
  );
}

/** Skeleton wrapping a gf-card-style outline. */
export function SkeletonCard({ children, padding = 18 }: { children?: React.ReactNode; padding?: number }) {
  return (
    <div
      className="gf-card"
      style={{ padding, display: 'flex', flexDirection: 'column', gap: 12 }}
      aria-busy="true"
    >
      {children}
    </div>
  );
}

import { Skeleton, SkeletonCard, SkeletonTableRow } from '@/components/ui/skeleton';

// Coach portal fallback. Coach Home shows quick-action tiles + earnings
// summary; Clients/Attendance/Schedule/Earnings sub-pages show a table.
// The skeleton renders both top sections so Suspense never thrashes between
// "spinner" and "list" — the layout is stable from the first paint.
export default function Loading() {
  return (
    <div className="gf-page" aria-busy="true">
      {/* Greeting header — matches the rebuilt coach .hdr chrome */}
      <header className="hdr" style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
          <Skeleton w={44} h={44} rounded={999} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton w={150} h={22} />
            <Skeleton w={130} h={13} />
          </div>
        </div>
        <Skeleton w={40} h={40} rounded={12} />
      </header>

      {/* KPI strip — 4-up to match the real coach KPI row */}
      <div className="kpis">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} padding={18}>
            <Skeleton w={80} h={10} />
            <Skeleton w={110} h={22} />
          </SkeletonCard>
        ))}
      </div>

      {/* Quick-actions / panel placeholder */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} w="100%" h={84} rounded={16} />
        ))}
      </section>

      {/* Recent activity table — Clients / Attendance / Sessions all use a table */}
      <SkeletonCard padding={0}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--gf-border)' }}>
          <Skeleton w={140} h={16} />
        </div>
        <div className="gf-table-wrap">
          <table className="gf-table">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonTableRow key={i} cols={4} />
              ))}
            </tbody>
          </table>
        </div>
      </SkeletonCard>
    </div>
  );
}

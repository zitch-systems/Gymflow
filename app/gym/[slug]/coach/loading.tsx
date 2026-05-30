import { Skeleton, SkeletonCard, SkeletonTableRow } from '@/components/ui/skeleton';

// Coach portal fallback. Coach Home shows quick-action tiles + earnings
// summary; Clients/Attendance/Schedule/Earnings sub-pages show a table.
// The skeleton renders both top sections so Suspense never thrashes between
// "spinner" and "list" — the layout is stable from the first paint.
export default function Loading() {
  return (
    <div className="member-portal member-app" aria-busy="true">
      {/* Greeting header (m-head) */}
      <header className="m-head">
        <Skeleton w={44} h={44} rounded={999} />
        <div className="m-head-text" style={{ gap: 6 }}>
          <Skeleton w={130} h={11} />
          <Skeleton w={150} h={18} />
        </div>
        <Skeleton w={38} h={38} rounded={999} style={{ marginLeft: 'auto' }} />
      </header>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} padding={14}>
            <Skeleton w={80} h={10} />
            <Skeleton w={110} h={22} />
          </SkeletonCard>
        ))}
      </div>

      {/* 3-up quick actions (m-qa) */}
      <section className="m-qa">
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

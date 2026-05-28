import { Skeleton, SkeletonCard, SkeletonTableRow } from '@/components/ui/skeleton';

// Coach portal fallback. Coach Home shows quick-action tiles + earnings
// summary; Clients/Attendance/Schedule/Earnings sub-pages show a table.
// The skeleton renders both top sections so Suspense never thrashes between
// "spinner" and "list" — the layout is stable from the first paint.
export default function Loading() {
  return (
    <div className="member-portal" aria-busy="true">
      {/* Greeting / coach name */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        <Skeleton w={200} h={22} />
        <Skeleton w={140} h={12} />
      </div>

      {/* Earnings / KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} padding={14}>
            <Skeleton w={80} h={10} />
            <Skeleton w={130} h={22} />
          </SkeletonCard>
        ))}
      </div>

      {/* 5-up quick-action tile row */}
      <section className="member-quick-actions">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="gf-quick-action"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '22px 10px 18px', minHeight: 120 }}
          >
            <Skeleton w={56} h={56} rounded={16} />
            <Skeleton w={56} h={11} />
          </div>
        ))}
      </section>

      <div style={{ height: 18 }} />

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

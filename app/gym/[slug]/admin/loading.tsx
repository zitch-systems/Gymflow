import { Skeleton, SkeletonCard, SkeletonTableRow } from '@/components/ui/skeleton';

// Admin Suspense fallback. Mimics the most common admin page shape — page
// header on top, then a card with a header and table — because Members,
// Audit, Pricing, Operations, Classes, Instructors, Wallet, Reminders all
// follow that pattern. Pages that don't (Analytics, Dashboard) still benefit
// from seeing the structural outline land before the data does.
export default function Loading() {
  return (
    <div className="gf-page" aria-busy="true">
      {/* Page header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        <Skeleton w={180} h={26} />
        <Skeleton w={280} h={12} />
      </div>

      {/* Stats / KPI row — matches Analytics + Dashboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} padding={14}>
            <Skeleton w={70} h={10} />
            <Skeleton w={110} h={22} />
            <Skeleton w={140} h={10} />
          </SkeletonCard>
        ))}
      </div>

      {/* Card-with-table — matches Members, Audit, Pricing, etc. */}
      <SkeletonCard padding={0}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--gf-border)' }}>
          <Skeleton w={140} h={16} />
        </div>
        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                {Array.from({ length: 5 }).map((_, i) => (
                  <th key={i} style={{ padding: '12px 14px' }}>
                    <Skeleton w={i === 0 ? 100 : 80} h={11} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonTableRow key={i} cols={5} />
              ))}
            </tbody>
          </table>
        </div>
      </SkeletonCard>
    </div>
  );
}

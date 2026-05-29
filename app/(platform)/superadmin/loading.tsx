import { Skeleton, SkeletonCard, SkeletonTableRow } from '@/components/ui/skeleton';

// Superadmin fallback. The cross-tenant pages (superadmin home, /audit,
// /members) share the same shape: page header + filter chip row + a wide
// table that joins across gyms. Match that here so the layout doesn't
// rearrange when the data lands.
export default function Loading() {
  return (
    <div className="gf-page" aria-busy="true">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton w={220} h={26} />
          <Skeleton w={300} h={12} />
        </div>
        <Skeleton w={70} h={30} rounded={8} />
      </div>

      <SkeletonCard padding={0}>
        {/* Filter chip row — matches the audit + members layout */}
        <div style={{ padding: 12, borderBottom: '1px solid var(--gf-border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Skeleton w={50} h={11} />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} w={70 + i * 10} h={22} rounded={999} />
          ))}
          <span style={{ flex: 1 }} />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} w={80} h={22} rounded={999} />
          ))}
        </div>

        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                {Array.from({ length: 5 }).map((_, i) => (
                  <th key={i} style={{ padding: '12px 14px' }}>
                    <Skeleton w={i === 0 ? 80 : 100} h={11} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }).map((_, i) => (
                <SkeletonTableRow key={i} cols={5} />
              ))}
            </tbody>
          </table>
        </div>
      </SkeletonCard>
    </div>
  );
}

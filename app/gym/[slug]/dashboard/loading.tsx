import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';

// Member dashboard fallback. Matches the actual layout: subscription status
// card on top, then the 5-up quick-action tile row that PR #6's polish bumped
// to 120px-tall chips. Lets members land on a stable layout while the data
// fetch finishes — no more 200ms blank screen + spinner.
export default function Loading() {
  return (
    <div className="member-portal" aria-busy="true">
      {/* Subscription status card */}
      <SkeletonCard padding={20}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton w={80} h={20} rounded={999} />
            <Skeleton w={120} h={36} />
            <Skeleton w={140} h={12} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <Skeleton w={150} h={11} />
          </div>
        </div>
      </SkeletonCard>

      <div style={{ height: 18 }} />

      {/* 5-up quick-action tile row — match the polished gf-quick-action shape */}
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

      {/* Profile / recent activity */}
      <SkeletonCard padding={20}>
        <Skeleton w={140} h={14} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton w={70} h={10} />
              <Skeleton w={120} h={14} />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}

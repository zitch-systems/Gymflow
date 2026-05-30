import { Skeleton } from '@/components/ui/skeleton';

// Member dashboard fallback. Mirrors the real layout (m-head greeting → the
// gradient m-status hero → the 3-up m-qa actions → the "More" m-lc list) so
// the page doesn't jump when the data resolves.
export default function Loading() {
  return (
    <div className="member-portal member-app" aria-busy="true">
      {/* Greeting header */}
      <header className="m-head">
        <Skeleton w={44} h={44} rounded={999} />
        <div className="m-head-text" style={{ gap: 6 }}>
          <Skeleton w={120} h={11} />
          <Skeleton w={150} h={18} />
        </div>
        <Skeleton w={38} h={38} rounded={999} style={{ marginLeft: 'auto' }} />
      </header>

      {/* Status hero — full-width gradient card placeholder */}
      <Skeleton w="100%" h={150} rounded={20} />

      {/* 3-up quick actions */}
      <section className="m-qa">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} w="100%" h={84} rounded={16} />
        ))}
      </section>

      {/* "More" list cards */}
      <Skeleton w={60} h={14} style={{ margin: '6px 2px 0' }} />
      <div className="m-links">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} w="100%" h={62} rounded={12} />
        ))}
      </div>
    </div>
  );
}

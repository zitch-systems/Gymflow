import { Skeleton } from '@/components/ui/skeleton';

// Member dashboard fallback. Mirrors the rebuilt DSv3 home layout (.mhead
// greeting → .status hero → .qa quick actions → secondary panels) so the
// page doesn't jump when the data resolves.
export default function Loading() {
  return (
    <div className="ds-member" aria-busy="true">
      <div className="view on">
        {/* Greeting header (.mhead) */}
        <header className="mhead">
          <Skeleton w={44} h={44} rounded={999} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <Skeleton w={120} h={11} />
            <Skeleton w={150} h={18} />
          </div>
          <Skeleton w={38} h={38} rounded={999} />
        </header>

        {/* Status hero — full-width gradient card placeholder */}
        <Skeleton w="100%" h={170} rounded={20} />

        {/* 4-up quick actions */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={84} rounded={16} />
          ))}
        </section>

        {/* Weekly streak card */}
        <Skeleton w="100%" h={130} rounded={16} style={{ marginTop: 14 }} />

        {/* Activity trio */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={80} rounded={12} />
          ))}
        </section>
      </div>
    </div>
  );
}

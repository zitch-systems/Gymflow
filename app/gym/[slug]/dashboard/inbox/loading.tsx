import { Skeleton } from '@/components/ui/skeleton';

// Inbox fallback. Mirrors the real layout (member-header title → a card of
// stacked m-lc message rows) so the list doesn't jump in when data resolves.
export default function Loading() {
  return (
    <div className="member-portal member-app" aria-busy="true">
      <header className="member-header">
        <div>
          <Skeleton w={90} h={22} />
          <Skeleton w={150} h={13} style={{ marginTop: 6 }} />
        </div>
        <Skeleton w={110} h={32} rounded={999} />
      </header>

      <div className="gf-card" style={{ padding: 14 }}>
        <div className="m-links">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={68} rounded={12} />
          ))}
        </div>
      </div>
    </div>
  );
}

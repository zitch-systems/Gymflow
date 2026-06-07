import { Skeleton } from '@/components/ui/skeleton';

// Inbox fallback. Mirrors the rebuilt DSv3 layout (.mhead with back arrow
// + title + spacer → grouped .notif rows) so the list doesn't jump.
export default function Loading() {
  return (
    <div className="ds-member" aria-busy="true">
      <div className="view on">
        <header className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
          <Skeleton w={34} h={34} rounded={10} />
          <Skeleton w={120} h={18} />
          <Skeleton w={34} h={34} rounded={10} />
        </header>

        <Skeleton w={60} h={11} style={{ marginBottom: 10, marginTop: 4 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={72} rounded={12} />
          ))}
        </div>
      </div>
    </div>
  );
}

import { MemberSkeleton } from '@/components/skeletons';

// Instant route-transition feedback for the member PWA. Without a loading
// boundary the old page stays frozen for the full auth+data round trip on
// every tab tap; this paints immediately while the dynamic payload streams
// (and gives <Link> prefetch a cacheable static shell). Nested segments have
// their own copies — a boundary only fires when ITS child segment changes.
export default MemberSkeleton;

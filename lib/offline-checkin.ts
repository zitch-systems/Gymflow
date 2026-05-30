// Offline check-in support — shared between the server action (trust
// boundary) and the browser queue (lib/checkin-queue.ts).
//
// When a member checks in at the gym with no connectivity (basement, weak
// Naija data), we queue the intent locally and replay it when the device
// reconnects. The replayed check-in must carry its ORIGINAL arrival time,
// not the sync time — otherwise the visit log is wrong. But a client-supplied
// timestamp is untrusted: it could be forged to backdate or future-date a
// visit. sanitizeOccurredAt is the server-side gate.

// How stale an offline check-in may be when it finally syncs. Past this we
// drop the timestamp (and the caller falls back to "now" or rejects) rather
// than write a misleading visit hours in the past.
export const MAX_OFFLINE_CHECKIN_AGE_MS = 12 * 60 * 60 * 1000; // 12h

// Tolerance for a client clock running slightly ahead of the server.
export const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000; // 2m

/**
 * Validate + clamp a client-supplied check-in timestamp for offline replay.
 * Returns a safe ISO string, or null if the value is unusable:
 *   - not a parseable date
 *   - in the future beyond a small clock-skew tolerance (forged/forward clock)
 *   - older than MAX_OFFLINE_CHECKIN_AGE_MS (too stale to trust as "today")
 *
 * `nowMs` is injected so the server passes Date.now() and tests stay
 * deterministic.
 */
export function sanitizeOccurredAt(
  occurredAtIso: string | null | undefined,
  nowMs: number,
): string | null {
  if (!occurredAtIso) return null;
  const t = new Date(occurredAtIso).getTime();
  if (!Number.isFinite(t)) return null;
  if (t > nowMs + CLOCK_SKEW_TOLERANCE_MS) return null;
  if (t < nowMs - MAX_OFFLINE_CHECKIN_AGE_MS) return null;
  return new Date(t).toISOString();
}

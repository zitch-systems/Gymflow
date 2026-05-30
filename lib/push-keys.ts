// Pure Web Push helpers shared by client (subscribe) and server (send).
// No `web-push` import here so this stays usable in the browser bundle and
// trivially unit-testable.

/**
 * Convert a base64url VAPID public key into the Uint8Array that
 * PushManager.subscribe()'s applicationServerKey expects. Browsers don't
 * accept the base64url string directly.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Build over an explicit ArrayBuffer so the result satisfies BufferSource
  // (PushManager.subscribe's applicationServerKey) — a plain `new Uint8Array(n)`
  // is typed Uint8Array<ArrayBufferLike>, which the DOM lib rejects.
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Whether a push-service HTTP status means the subscription is permanently
 * gone and we should prune our stored row. 404 = unknown subscription,
 * 410 = Gone. Anything else (429 rate limit, 5xx) is transient — keep it.
 */
export function isDeadSubscriptionStatus(status: number): boolean {
  return status === 404 || status === 410;
}

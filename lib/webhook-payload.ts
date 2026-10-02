import 'server-only';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';

/** Encrypt the original verified provider body. Some lifecycle events carry a
 * cancellation token needed for replay, so redaction would make the recovery
 * copy incomplete. The ciphertext is service-role-only and uses the same
 * permanent AES-256-GCM key as other recoverable application secrets. */
export function encryptWebhookPayload(payload: Record<string, unknown>): string {
  return encryptSecret(JSON.stringify(payload));
}

export function decryptWebhookPayload(ciphertext: string): Record<string, unknown> {
  const clear = decryptSecret(ciphertext);
  if (!clear) throw new Error('recovery payload cannot be decrypted');
  const parsed = JSON.parse(clear);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid recovery payload');
  return parsed as Record<string, unknown>;
}

import 'server-only';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  privateDecrypt,
  type KeyObject,
} from 'crypto';

// Meta Flows endpoint encryption.
//
// A Flow that talks to a server does NOT get plain JSON. Every exchange is
// end-to-end encrypted between the member's WhatsApp client and us, and Meta
// only relays the ciphertext. The scheme is fixed and unforgiving — one wrong
// parameter and every request fails identically with a decryption error, so the
// details are spelled out here rather than left implicit:
//
//   1. The client generates a random 128-bit AES key per Flow session and
//      encrypts it to our RSA public key with RSA-OAEP, SHA-256 for BOTH the
//      OAEP hash and the MGF1 hash. Node defaults MGF1 to SHA-1, so it must be
//      set explicitly.
//   2. The request body is AES-128-GCM. Meta appends the 16-byte auth tag to
//      the ciphertext, so it has to be split off before decrypting.
//   3. The response uses the SAME AES key with a BITWISE-INVERTED IV, and the
//      tag is appended to the ciphertext again. Reusing the IV unflipped would
//      be a catastrophic two-time-pad on a GCM keystream; the flip is what makes
//      the response a distinct nonce.
//   4. The response is returned as a bare base64 string with content-type
//      text/plain — not JSON, not a JSON string.
//
// Key material: WHATSAPP_FLOW_PRIVATE_KEY (PEM, PKCS#8), optionally protected
// by WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE. The matching public key is uploaded
// to Meta with the phone number's whatsapp_business_encryption endpoint.
// Generate with:
//   openssl genrsa -des3 -out private.pem 2048
//   openssl rsa -in private.pem -outform PEM -pubout -out public.pem

export type FlowRequestBody = {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
};

export type DecryptedFlowRequest = {
  version: string;
  action: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
};

export type FlowCryptoContext = {
  aesKey: Buffer;
  initialVector: Buffer;
};

/** Meta's Flow JSON / data-API version this endpoint speaks. */
export const FLOW_DATA_API_VERSION = '3.0';

let cachedKey: KeyObject | null = null;

function privateKey(): KeyObject {
  if (cachedKey) return cachedKey;
  const pem = process.env.WHATSAPP_FLOW_PRIVATE_KEY;
  if (!pem) throw new Error('WHATSAPP_FLOW_PRIVATE_KEY is not set');
  // Vercel env vars cannot hold real newlines, so the PEM is stored with "\n"
  // escapes and unescaped here. A PEM without line breaks is not parseable.
  const normalized = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  const passphrase = process.env.WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE;
  cachedKey = createPrivateKey(passphrase ? { key: normalized, passphrase } : { key: normalized });
  return cachedKey;
}

export function flowCryptoConfigured(): boolean {
  try { privateKey(); return true; } catch { return false; }
}

/**
 * Decrypt an inbound Flow exchange.
 *
 * Throws `FlowKeyError` when the AES key itself will not unwrap. That distinction
 * matters to the caller: Meta's contract says a 421 tells the client to refetch
 * our public key and retry, which is the correct response to a key rotation and
 * the wrong response to a malformed body.
 */
export class FlowKeyError extends Error {}

export function decryptFlowRequest(body: FlowRequestBody): {
  request: DecryptedFlowRequest;
  context: FlowCryptoContext;
} {
  let aesKey: Buffer;
  try {
    aesKey = privateDecrypt(
      {
        key: privateKey(),
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
        // Node would otherwise default MGF1 to SHA-1 and every unwrap fails.
        mgf1Hash: 'sha256',
      } as Parameters<typeof privateDecrypt>[0],
      Buffer.from(body.encrypted_aes_key, 'base64'),
    );
  } catch (e) {
    throw new FlowKeyError(`AES key unwrap failed: ${(e as Error).message}`);
  }

  const initialVector = Buffer.from(body.initial_vector, 'base64');
  const payload = Buffer.from(body.encrypted_flow_data, 'base64');
  const TAG_BYTES = 16;
  if (payload.length <= TAG_BYTES) throw new Error('Encrypted flow data is too short to contain a tag.');

  const ciphertext = payload.subarray(0, -TAG_BYTES);
  const authTag = payload.subarray(-TAG_BYTES);

  const decipher = createDecipheriv('aes-128-gcm', aesKey, initialVector);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  return { request: JSON.parse(plaintext) as DecryptedFlowRequest, context: { aesKey, initialVector } };
}

/**
 * Encrypt a response for the client. Returns base64 the caller must send as a
 * text/plain body.
 */
export function encryptFlowResponse(payload: unknown, context: FlowCryptoContext): string {
  // Bitwise inversion of every IV byte — Meta's specified nonce for the
  // response leg.
  const flipped = Buffer.from(context.initialVector.map((b) => ~b & 0xff));
  const cipher = createCipheriv('aes-128-gcm', context.aesKey, flipped);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return encrypted.toString('base64');
}

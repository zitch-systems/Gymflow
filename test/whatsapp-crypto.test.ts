import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, publicEncrypt, createCipheriv, createDecipheriv, constants, randomBytes } from 'node:crypto';

// Meta's Flow encryption has no forgiving failure mode: one wrong parameter and
// every request fails identically with "decryption failed", which tells you
// nothing about which of the five knobs is wrong. These tests pin the scheme by
// standing in for the WhatsApp client — encrypting a request the way Meta does,
// and decrypting our response the way Meta does — so a regression is caught
// here rather than as an unexplained outage on a live number.

const PASSPHRASE = 'test-passphrase';
let privatePem: string;
let publicPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: PASSPHRASE },
  });
  privatePem = pair.privateKey;
  publicPem = pair.publicKey;
  process.env.WHATSAPP_FLOW_PRIVATE_KEY = privatePem;
  process.env.WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE = PASSPHRASE;
});

/** Encrypt a request exactly as the WhatsApp client does. */
function encryptAsClient(payload: unknown) {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    aesKey,
    iv,
    body: {
      encrypted_aes_key: publicEncrypt(
        { key: publicPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        aesKey,
      ).toString('base64'),
      // Meta appends the GCM tag to the ciphertext rather than sending it apart.
      encrypted_flow_data: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
      initial_vector: iv.toString('base64'),
    },
  };
}

/** Decrypt our response exactly as the WhatsApp client does. */
function decryptAsClient(base64: string, aesKey: Buffer, iv: Buffer): unknown {
  const flipped = Buffer.from(iv.map((b) => ~b & 0xff));
  const payload = Buffer.from(base64, 'base64');
  const decipher = createDecipheriv('aes-128-gcm', aesKey, flipped);
  decipher.setAuthTag(payload.subarray(-16));
  const plain = Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

describe('Flow endpoint encryption', () => {
  it('decrypts a request the client encrypted', async () => {
    const { decryptFlowRequest } = await import('@/lib/whatsapp/flow-crypto');
    const { body } = encryptAsClient({ version: '3.0', action: 'ping', flow_token: 'tok' });
    const { request } = decryptFlowRequest(body.encrypted_flow_data ? body : body);
    expect(request.action).toBe('ping');
    expect(request.flow_token).toBe('tok');
  });

  it('produces a response the client can decrypt, using the flipped IV', async () => {
    const { decryptFlowRequest, encryptFlowResponse } = await import('@/lib/whatsapp/flow-crypto');
    const { aesKey, iv, body } = encryptAsClient({ version: '3.0', action: 'ping' });
    const { context } = decryptFlowRequest(body);
    const encrypted = encryptFlowResponse({ version: '3.0', data: { status: 'active' } }, context);
    expect(decryptAsClient(encrypted, aesKey, iv)).toEqual({ version: '3.0', data: { status: 'active' } });
  });

  // The flip is not decoration: reusing the IV unflipped would run the response
  // on the same GCM keystream as the request — a two-time pad on live traffic.
  it('does not reuse the request IV for the response', async () => {
    const { decryptFlowRequest, encryptFlowResponse } = await import('@/lib/whatsapp/flow-crypto');
    const { aesKey, iv, body } = encryptAsClient({ version: '3.0', action: 'ping' });
    const { context } = decryptFlowRequest(body);
    const encrypted = encryptFlowResponse({ ok: true }, context);
    const decipher = createDecipheriv('aes-128-gcm', aesKey, iv);
    const payload = Buffer.from(encrypted, 'base64');
    decipher.setAuthTag(payload.subarray(-16));
    expect(() => Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()])).toThrow();
  });

  it('rejects a tampered payload rather than returning altered data', async () => {
    const { decryptFlowRequest } = await import('@/lib/whatsapp/flow-crypto');
    const { body } = encryptAsClient({ version: '3.0', action: 'ping' });
    const bytes = Buffer.from(body.encrypted_flow_data, 'base64');
    bytes[0] ^= 0xff;
    expect(() => decryptFlowRequest({ ...body, encrypted_flow_data: bytes.toString('base64') })).toThrow();
  });

  it('raises FlowKeyError when the AES key was wrapped to a different public key', async () => {
    const { decryptFlowRequest, FlowKeyError } = await import('@/lib/whatsapp/flow-crypto');
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const { body } = encryptAsClient({ version: '3.0', action: 'ping' });
    const wrongWrap = publicEncrypt(
      { key: other.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      randomBytes(16),
    ).toString('base64');
    // The distinction matters: a key mismatch must produce a 421 so the client
    // refetches our public key, which is what makes a rotation survivable.
    expect(() => decryptFlowRequest({ ...body, encrypted_aes_key: wrongWrap })).toThrow(FlowKeyError);
  });
});

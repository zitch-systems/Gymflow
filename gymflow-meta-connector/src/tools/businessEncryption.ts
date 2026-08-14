/**
 * The Flow endpoint's encryption key, as Meta holds it.
 *
 * A Flow with a `data_api_version` talks to our endpoint over an envelope only
 * the two ends can open: Meta encrypts the request's AES key with our RSA
 * PUBLIC key, and our endpoint decrypts it with the PRIVATE half. Meta will not
 * publish — or even send — such a Flow until it has been given that public key
 * and has signed it against the phone number. The Flow Builder reports this as
 * "You need to upload and sign a public key to a phone number", with no way to
 * do it from the UI: the only route is this Graph edge.
 *
 * That made it the one step in bringing the channel up that could not be done
 * without a shell and a system-user token, which is precisely the gap this
 * connector exists to close. Hence these two tools.
 *
 * Only the public half is ever accepted here — the schema rejects anything
 * carrying "PRIVATE KEY" outright. The private key belongs in the endpoint's
 * environment and nowhere else; sending it to Meta would hand away the ability
 * to read every Flow submission, which on this Flow means passwords.
 */
import type { Config } from '../config.js';
import { graphGet, graphPost } from '../metaClient.js';
import type { GetBusinessEncryptionInput, SetBusinessEncryptionInput } from '../schemas.js';
import { assertConfirmed } from './writes.js';

export interface BusinessEncryptionResult {
  phoneNumberId: string;
  /** PEM of the key Meta currently holds, or undefined when none is registered. */
  businessPublicKey?: string;
  /**
   * Meta's signature state for the key. Publishing a Flow requires this to have
   * reached its valid state; a key that is uploaded but not yet signed still
   * blocks publish, which is a confusing thing to debug from the Builder alone.
   */
  signatureStatus?: string;
  configured: boolean;
}

interface EncryptionNode {
  business_public_key?: string;
  business_public_key_signature_status?: string;
}

export async function getBusinessEncryption(
  config: Config,
  input: GetBusinessEncryptionInput,
): Promise<BusinessEncryptionResult> {
  const phoneNumberId = input.phoneNumberId ?? config.metaPhoneNumberId;
  const node = (await graphGet(config, `${phoneNumberId}/whatsapp_business_encryption`)) as
    | EncryptionNode
    | { data?: EncryptionNode[] };
  // The edge has returned both a bare node and a single-element `data` array
  // across API versions. Accept either rather than pin to one and break on the
  // next version bump.
  const row: EncryptionNode =
    'data' in node && Array.isArray(node.data) ? (node.data[0] ?? {}) : (node as EncryptionNode);
  return {
    phoneNumberId,
    businessPublicKey: row.business_public_key,
    signatureStatus: row.business_public_key_signature_status,
    configured: Boolean(row.business_public_key),
  };
}

export interface SetBusinessEncryptionResult {
  action: 'set_whatsapp_business_encryption';
  phoneNumberId: string;
  success: boolean;
  signatureStatus?: string;
  note: string;
}

export async function setBusinessEncryption(
  config: Config,
  input: SetBusinessEncryptionInput,
): Promise<SetBusinessEncryptionResult> {
  const phoneNumberId = input.phoneNumberId ?? config.metaPhoneNumberId;
  assertConfirmed(config, phoneNumberId, input.confirm);
  const res = (await graphPost(config, `${phoneNumberId}/whatsapp_business_encryption`, {
    business_public_key: input.businessPublicKey,
  })) as { success?: boolean };
  // Read back rather than trust the write's `success`: the upload can succeed
  // while the signature is still pending, and pending does not publish.
  const after = await getBusinessEncryption(config, { phoneNumberId });
  return {
    action: 'set_whatsapp_business_encryption',
    phoneNumberId,
    success: res.success !== false && after.configured,
    signatureStatus: after.signatureStatus,
    note:
      'The endpoint holding the matching PRIVATE key must be deployed before the Flow is ' +
      'published — Meta health-checks it with an encrypted ping, and a mismatched or missing ' +
      'private key fails that check.',
  };
}

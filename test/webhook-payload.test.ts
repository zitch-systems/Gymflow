import { afterEach, describe, expect, it } from 'vitest';
import { decryptWebhookPayload, encryptWebhookPayload } from '@/lib/webhook-payload';

afterEach(() => { delete process.env.SECRETS_ENCRYPTION_KEY; });

describe('queued webhook payload encryption', () => {
  it('round-trips the provider token without storing it as plaintext', () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const event = {
      event: 'subscription.create',
      data: { subscription_code: 'SUB_1', email_token: 'token-needed-for-replay' },
    };
    const encrypted = encryptWebhookPayload(event);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('token-needed-for-replay');
    expect(decryptWebhookPayload(encrypted)).toEqual(event);
  });

  it('fails closed when the permanent encryption key is absent', () => {
    expect(() => encryptWebhookPayload({ event: 'charge.success' })).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });
});

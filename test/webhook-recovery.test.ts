import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  dispatch: vi.fn(),
  verify: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/paystack-webhook', () => ({
  processPaystackEvent: calls.dispatch,
  eventReference: (event: { data?: { reference?: unknown } }) =>
    typeof event.data?.reference === 'string' ? event.data.reference : null,
}));
vi.mock('@/lib/paystack', () => ({ verifyTransaction: calls.verify }));
vi.mock('@/lib/server-error', () => ({ captureServerEvent: calls.capture }));
vi.mock('@/lib/webhook-payload', () => ({
  decryptWebhookPayload: (ciphertext: string) => JSON.parse(ciphertext),
  encryptWebhookPayload: (event: unknown) => JSON.stringify(event),
}));

import { processClaimedPaystackEvent, type WebhookJob } from '@/lib/webhook-recovery';

function harness() {
  const select = vi.fn().mockResolvedValue({ data: [{ body_hash: 'a'.repeat(64) }], error: null });
  const chain = { eq: vi.fn(), select };
  chain.eq.mockReturnValue(chain);
  const update = vi.fn().mockReturnValue(chain);
  const admin = { from: vi.fn().mockReturnValue({ update }) };
  return { admin, update };
}

function job(event: Record<string, unknown>): WebhookJob {
  return {
    body_hash: 'a'.repeat(64), event_name: String(event.event), reference: 'ref_verified',
    source: 'webhook', payload_ciphertext: JSON.stringify(event), attempts: 1, lock_token: 'lock_fixture',
  };
}

describe('durable webhook recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.dispatch.mockResolvedValue({ outcome: 'completed', status: 200 });
    calls.capture.mockResolvedValue(undefined);
  });

  it('rebuilds an HMAC-ingested charge from Paystack verification before dispatch', async () => {
    calls.verify.mockResolvedValue({
      ok: true, status: 'success', channel: 'bank', memberEventData: {
        reference: 'ref_verified', amount: 90_000, metadata: { member_id: 'member_verified' },
      },
    });
    const { admin, update } = harness();

    await expect(processClaimedPaystackEvent(admin as never, job({
      event: 'charge.success', data: { reference: 'ref_verified', amount: 1, metadata: { member_id: 'tampered' } },
    }))).resolves.toEqual({ outcome: 'completed', status: 200 });

    expect(calls.verify).toHaveBeenCalledWith('ref_verified');
    expect(calls.dispatch).toHaveBeenCalledWith({
      event: 'charge.success',
      data: { reference: 'ref_verified', amount: 90_000, metadata: { member_id: 'member_verified' }, channel: 'bank' },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('dead-letters a charge the provider says is not successful', async () => {
    calls.verify.mockResolvedValue({ ok: true, status: 'failed', channel: null, memberEventData: {} });
    const { admin, update } = harness();

    await expect(processClaimedPaystackEvent(admin as never, job({
      event: 'charge.success', data: { reference: 'ref_verified' },
    }))).resolves.toEqual({ outcome: 'permanent_failure', status: 422, error: 'provider status is failed' });

    expect(calls.dispatch).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
    expect(calls.capture).toHaveBeenCalledWith(
      'paystack recovery requires operator repair',
      expect.objectContaining({ reference: 'ref_verified', attempts: 1 }),
    );
  });
});

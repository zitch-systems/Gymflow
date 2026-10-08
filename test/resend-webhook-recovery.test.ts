import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), verify: vi.fn(), ledger: vi.fn(), suppression: vi.fn(), capture: vi.fn(),
}));
vi.mock('@/lib/email/recipients', () => ({ adminOrNull: mocks.admin }));
vi.mock('@/lib/webhook-verify', () => ({
  verifyStandardWebhook: mocks.verify,
  standardWebhookHeaders: () => ({ id: 'delivery-1', timestamp: '1', signature: 'signature' }),
}));
vi.mock('@/lib/server-error', () => ({ captureServerEvent: mocks.capture }));
import { POST } from '@/app/api/resend/webhook/route';

function request(type = 'email.delivered') {
  return new NextRequest('https://example.test/api/resend/webhook', {
    method: 'POST', body: JSON.stringify({ type, data: { to: ['member@example.test'] } }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('RESEND_WEBHOOK_SECRET', 'test-only');
  mocks.verify.mockReturnValue(true);
  mocks.ledger.mockResolvedValue({ error: null });
  mocks.suppression.mockResolvedValue({ error: null });
  mocks.capture.mockResolvedValue(undefined);
  mocks.admin.mockReturnValue({ from: (table: string) => ({
    upsert: table === 'email_events' ? mocks.ledger : mocks.suppression,
  }) });
});

describe('Resend durable acknowledgement', () => {
  it('refuses forged events before database access', async () => {
    mocks.verify.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('requests retry when storage configuration is unavailable', async () => {
    mocks.admin.mockReturnValue(null);
    expect((await POST(request())).status).toBe(503);
  });
  it('retries ledger failures while preserving a stable event identity', async () => {
    mocks.ledger.mockResolvedValueOnce({ error: { message: 'temporary failure' } });
    expect((await POST(request())).status).toBe(503);
    expect((await POST(request())).status).toBe(200);
    for (const [row, options] of mocks.ledger.mock.calls) {
      expect(row.event_id).toBe('delivery-1');
      expect(options).toEqual({ onConflict: 'event_id', ignoreDuplicates: true });
    }
  });
  it('retries failed complaint suppression even after the ledger succeeds', async () => {
    mocks.suppression.mockResolvedValueOnce({ error: { message: 'temporary failure' } });
    expect((await POST(request('email.complained'))).status).toBe(503);
    expect((await POST(request('email.complained'))).status).toBe(200);
    expect(mocks.suppression).toHaveBeenCalledTimes(2);
    expect(mocks.suppression.mock.calls[1][1]).toEqual({ onConflict: 'address', ignoreDuplicates: true });
  });
  it('still suppresses a hard bounce when the ledger fails', async () => {
    mocks.ledger.mockResolvedValue({ error: { message: 'temporary failure' } });
    expect((await POST(request('email.bounced'))).status).toBe(503);
    expect(mocks.suppression).toHaveBeenCalledTimes(1);
  });
  it('acknowledges stored unknown events without suppressing recipients', async () => {
    expect((await POST(request('verification.probe'))).status).toBe(200);
    expect(mocks.suppression).not.toHaveBeenCalled();
  });
});

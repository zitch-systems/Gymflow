import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (columns: string) => {
        const chain = {
          eq: vi.fn(() => chain),
          limit: () => calls.read(columns),
          maybeSingle: () => calls.read(columns),
        };
        return chain;
      },
      update: calls.update,
    }),
    rpc: calls.rpc,
  }),
}));
vi.mock('@/lib/server-error', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { handlePlatformEvent } from '@/lib/platform-fulfill';

describe('platform payment lookup failures', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { subscription_code: 'SUB_fixture', metadata: { gym_id: 'gym_fixture' } },
    { customer: { customer_code: 'CUS_fixture' }, metadata: { gym_id: 'gym_fixture' } },
    { metadata: { gym_id: 'gym_fixture' } },
  ])('retries a failed mapping read without falling back to metadata: %j', async (data) => {
    calls.read.mockResolvedValue({ data: null, error: { message: 'private database details' } });
    await expect(handlePlatformEvent({ event: 'charge.success', data: { reference: 'ref_fixture', ...data } }))
      .rejects.toThrow('Platform gym mapping lookup failed');
    expect(calls.read).toHaveBeenCalledTimes(1);
    expect(calls.update).not.toHaveBeenCalled();
    expect(calls.rpc).not.toHaveBeenCalled();
  });

  it('does not ignore a failed customer cross-check after finding a subscription', async () => {
    calls.read.mockResolvedValueOnce({ data: [{ id: 'gym_fixture' }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    await expect(handlePlatformEvent({ event: 'charge.success', data: {
      reference: 'ref_fixture', subscription_code: 'SUB_fixture', customer: { customer_code: 'CUS_fixture' },
    } })).rejects.toThrow('Platform gym mapping lookup failed');
    expect(calls.rpc).not.toHaveBeenCalled();
  });

  it.each(['subscription.create', 'subscription.disable', 'invoice.payment_failed'])(
    'leaves the mandate and access unchanged when %s cannot read current state', async (event) => {
      calls.read.mockResolvedValueOnce({ data: [{ id: 'gym_fixture' }], error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
      expect(await handlePlatformEvent({ event, data: { subscription_code: 'SUB_fixture' } }))
        .toEqual({ ok: false, handled: true, error: 'Platform subscription state unavailable' });
      expect(calls.update).not.toHaveBeenCalled();
      expect(calls.rpc).not.toHaveBeenCalled();
    },
  );

  it('keeps a successfully checked but missing mapping as an operator repair', async () => {
    calls.read.mockResolvedValue({ data: [], error: null });
    expect(await handlePlatformEvent({ event: 'charge.success', data: {
      reference: 'ref_fixture', subscription_code: 'SUB_fixture',
    } })).toEqual({ ok: false, handled: true, error: 'could not resolve gym for charge', permanent: true });
    expect(calls.rpc).not.toHaveBeenCalled();
  });
});

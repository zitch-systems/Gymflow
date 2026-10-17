import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminStaff } from '@/lib/auth/dal';
import { verifyTransaction } from '@/lib/paystack';
import { handlePlatformEvent } from '@/lib/platform-fulfill';
import BillingCallback from '@/app/billing/callback/page';
import { readSplit } from '@/lib/paystack-split';

vi.mock('@/lib/auth/dal', () => ({ requireAdminStaff: vi.fn() }));
vi.mock('@/lib/paystack', () => ({ verifyTransaction: vi.fn() }));
vi.mock('@/lib/platform-fulfill', () => ({ handlePlatformEvent: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement('a', null, children) }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requireAdminStaff).mockResolvedValue({ gym: { id: 'gym-a' } } as Awaited<ReturnType<typeof requireAdminStaff>>);
  vi.mocked(verifyTransaction).mockResolvedValue({
    ok: true, status: 'success', reference: 'paid-ref', amountKobo: 1500000,
    metadata: { gym_id: 'gym-a' },
    currency: 'NGN', channel: 'card', split: readSplit({}), memberEventData: {},
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('platform payment return', () => {
  it('keeps a charged but unfulfilled payment pending and prevents a false activation message', async () => {
    vi.mocked(handlePlatformEvent).mockResolvedValue({ ok: false, handled: true, error: 'Temporary database failure' });
    const html = renderToStaticMarkup(await BillingCallback({ searchParams: Promise.resolve({ reference: 'paid-ref' }) }));
    expect(html).toContain('activation pending');
    expect(html).toContain('Please do not pay again');
    expect(html).toContain('paid-ref');
    expect(html).not.toContain('Subscription active');
  });

  it('confirms activation only after successful fulfillment', async () => {
    vi.mocked(handlePlatformEvent).mockResolvedValue({ ok: true, handled: true });
    const html = renderToStaticMarkup(await BillingCallback({ searchParams: Promise.resolve({ reference: 'paid-ref' }) }));
    expect(html).toContain('Subscription active');
    expect(handlePlatformEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fulfill another gym’s payment', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({
      ok: true, status: 'success', reference: 'foreign-ref', amountKobo: 1500000,
      metadata: { gym_id: 'gym-b' },
      currency: 'NGN', channel: 'card', split: readSplit({}), memberEventData: {},
    });
    const html = renderToStaticMarkup(await BillingCallback({ searchParams: Promise.resolve({ reference: 'foreign-ref' }) }));
    expect(html).toContain('different gym');
    expect(handlePlatformEvent).not.toHaveBeenCalled();
  });
});

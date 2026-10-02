import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { listTransactionsPage } = await import('@/lib/paystack');

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_not_real';
  fetchMock.mockReset();
});

afterEach(() => {
  delete process.env.PAYSTACK_SECRET_KEY;
});

describe('Paystack transaction page', () => {
  it('requests the persisted page and reports provider completion metadata', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: [{ reference: 'ref-401', status: 'success', amount: 125000, currency: 'NGN', metadata: { gym_id: 'g1' } }],
      meta: { page: 3, pageCount: 3 },
    }), { status: 200 }));

    const result = await listTransactionsPage({
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z'),
      status: 'success', page: 3,
    });
    expect(result).toMatchObject({ ok: true, page: 3, complete: true });
    expect(fetchMock.mock.calls[0][0]).toContain('page=3');
    expect(fetchMock.mock.calls[0][0]).toContain('perPage=200');
  });

  it('does not guess that a full page is the end when no page count is present', async () => {
    const data = Array.from({ length: 200 }, (_, i) => ({ reference: `ref-${i}`, status: 'success', amount: 100 }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: true, data }), { status: 200 }));
    const result = await listTransactionsPage({ from: new Date('2026-01-01T00:00:00Z'), page: 6 });
    expect(result).toMatchObject({ ok: true, page: 6, complete: false });
  });
});

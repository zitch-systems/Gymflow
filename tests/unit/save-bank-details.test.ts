import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

const { state, capturingClient, resolveAccountMock, requireInstructorMock } = vi.hoisted(() => {
  type UpsertCall = { table: string; payload: Record<string, unknown>; options: unknown };
  const state: { upserts: UpsertCall[]; upsertError: { message: string } | null } = {
    upserts: [],
    upsertError: null,
  };
  const capturingClient = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>, options: unknown) {
          state.upserts.push({ table, payload, options });
          return Promise.resolve({ error: state.upsertError });
        },
      };
    },
  };
  const resolveAccountMock = vi.fn(async () => ({ account_number: '0123456789', account_name: 'NGOZI ADE' }));
  const requireInstructorMock = vi.fn(async () => ({
    gym: { id: 'gym-1', name: 'TestGym' },
    user: { id: 'coach-1' },
    link: {},
  }));
  return { state, capturingClient, resolveAccountMock, requireInstructorMock };
});

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => capturingClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/paystack', () => ({ resolveAccount: resolveAccountMock }));
vi.mock('@/lib/auth/gym', () => ({ requireInstructor: requireInstructorMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { saveBankDetails } from '@/lib/actions/coach';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.upserts = [];
  state.upsertError = null;
  resolveAccountMock.mockClear();
  resolveAccountMock.mockResolvedValue({ account_number: '0123456789', account_name: 'NGOZI ADE' });
});

describe('saveBankDetails — validation', () => {
  it('rejects a non-numeric bank code without calling Paystack', async () => {
    const r = await saveBankDetails('demo', fd({ bank_code: 'GTB', bank_name: 'GTBank', account_number: '0123456789' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid bank code/);
    expect(resolveAccountMock).not.toHaveBeenCalled();
    expect(state.upserts).toHaveLength(0);
  });

  it('rejects an account number that is not 10 digits', async () => {
    const r = await saveBankDetails('demo', fd({ bank_code: '058', bank_name: 'GTBank', account_number: '999' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10 digits/);
    expect(resolveAccountMock).not.toHaveBeenCalled();
  });

  it('rejects a missing bank name', async () => {
    const r = await saveBankDetails('demo', fd({ bank_code: '058', bank_name: '', account_number: '0123456789' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bank name required/);
  });
});

describe('saveBankDetails — Paystack verification', () => {
  it('returns the Paystack error and does NOT write when resolve fails', async () => {
    resolveAccountMock.mockRejectedValueOnce(new Error('Account not found'));
    const r = await saveBankDetails('demo', fd({ bank_code: '058', bank_name: 'GTBank', account_number: '0123456789' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not verify account.*Account not found/);
    expect(state.upserts).toHaveLength(0);
  });

  it('upserts the verified account name from Paystack (not user input) on success', async () => {
    const r = await saveBankDetails('demo', fd({ bank_code: '058', bank_name: 'GTBank', account_number: '0123456789' }));
    expect(r.ok).toBe(true);
    expect(resolveAccountMock).toHaveBeenCalledWith('0123456789', '058');
    expect(state.upserts).toHaveLength(1);
    const call = state.upserts[0]!;
    expect(call.table).toBe('instructor_bank_details');
    expect(call.payload).toMatchObject({
      instructor_id: 'coach-1',
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '0123456789',
      account_name: 'NGOZI ADE', // came from Paystack, not the form
    });
    expect(call.options).toMatchObject({ onConflict: 'instructor_id' });
  });

  it('surfaces a DB error from the upsert', async () => {
    state.upsertError = { message: 'unique violation' };
    const r = await saveBankDetails('demo', fd({ bank_code: '058', bank_name: 'GTBank', account_number: '0123456789' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unique violation');
  });
});

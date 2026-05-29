import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabase, type MockSupabase } from './_mock-supabase';
import './_stub-server-only';

const { state, paystackMock, auditMock, requireManagerMock, getSessionMock } = vi.hoisted(() => {
  const state: { client: MockSupabase | null } = { client: null };
  const paystackMock = {
    resolveAccount: vi.fn(async () => ({ account_number: '0123456789', account_name: 'AKIN OLA' })),
    createTransferRecipient: vi.fn(async () => ({
      recipient_code: 'RCP_new123',
      type: 'nuban',
      name: 'AKIN OLA',
      details: { account_number: '0123456789', account_name: 'AKIN OLA', bank_code: '058', bank_name: 'GTBank' },
    })),
    initiateTransfer: vi.fn(async () => ({
      transfer_code: 'TRF_abc',
      reference: 'pay-1',
      amount: 100000,
      status: 'pending',
    })),
  };
  type AuditArg = { action: string; after?: Record<string, unknown>; before?: Record<string, unknown> };
  const auditMock = vi.fn(async (args: AuditArg) => { void args; });
  const requireManagerMock = vi.fn(async () => ({ role: 'owner', gym: { id: 'gym-1', name: 'TestGym' } }));
  const getSessionMock = vi.fn(async () => ({ id: 'admin-1' }));
  return { state, paystackMock, auditMock, requireManagerMock, getSessionMock };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }));
vi.mock('@/lib/paystack', () => paystackMock);
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/gym', () => ({ requireManager: requireManagerMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { processPayout, rejectPayout } from '@/lib/actions/payouts';

function formData(o: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  paystackMock.resolveAccount.mockClear();
  paystackMock.createTransferRecipient.mockClear();
  paystackMock.initiateTransfer.mockClear();
  auditMock.mockClear();
  // default success flow gets reset per-test
  paystackMock.resolveAccount.mockResolvedValue({ account_number: '0123456789', account_name: 'AKIN OLA' });
  paystackMock.createTransferRecipient.mockResolvedValue({
    recipient_code: 'RCP_new123',
    type: 'nuban',
    name: 'AKIN OLA',
    details: { account_number: '0123456789', account_name: 'AKIN OLA', bank_code: '058', bank_name: 'GTBank' },
  });
  paystackMock.initiateTransfer.mockResolvedValue({
    transfer_code: 'TRF_abc',
    reference: 'pay-1',
    amount: 100000,
    status: 'pending',
  });
});

describe('processPayout — input validation', () => {
  it('rejects non-numeric bank codes', async () => {
    state.client = createMockSupabase([]);
    const r = await processPayout('demo', 'pay-1', formData({
      bank_code: 'GTB',
      bank_name: 'GTBank',
      account_number: '0123456789',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid bank code/);
    expect(paystackMock.resolveAccount).not.toHaveBeenCalled();
  });

  it('rejects account numbers that are not exactly 10 digits', async () => {
    state.client = createMockSupabase([]);
    const r = await processPayout('demo', 'pay-1', formData({
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '12345',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10 digits/);
  });

  it('rejects when bank_name is missing — needed for the audit log', async () => {
    state.client = createMockSupabase([]);
    const r = await processPayout('demo', 'pay-1', formData({
      bank_code: '058',
      bank_name: '',
      account_number: '0123456789',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bank name required/);
  });
});

describe('processPayout — payout lookup', () => {
  it('returns "Payout not found" when the id matches no row', async () => {
    state.client = createMockSupabase([
      { data: null, error: null },
    ]);
    const r = await processPayout('demo', 'missing', formData({
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '0123456789',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Payout not found');
  });

  it('refuses to process a row already in approved/paid state', async () => {
    state.client = createMockSupabase([
      { data: { id: 'pay-1', gym_id: 'gym-1', instructor_id: 'coach-1', amount: 50000, status: 'paid' }, error: null },
    ]);
    const r = await processPayout('demo', 'pay-1', formData({
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '0123456789',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already paid/);
    expect(paystackMock.resolveAccount).not.toHaveBeenCalled();
  });
});

describe('processPayout — Paystack flow', () => {
  it('resolves account → creates recipient → initiates transfer → updates + audits', async () => {
    state.client = createMockSupabase([
      // 1. payout lookup
      { data: { id: 'pay-1', gym_id: 'gym-1', instructor_id: 'coach-1', amount: 50000, status: 'requested' }, error: null },
      // 2. prior recipient lookup — none yet
      { data: null, error: null },
      // 3. update
      { data: null, error: null },
    ]);

    const r = await processPayout('demo', 'pay-1', formData({
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '0123456789',
    }));

    expect(r.ok).toBe(true);
    expect(paystackMock.resolveAccount).toHaveBeenCalledWith('0123456789', '058');
    expect(paystackMock.createTransferRecipient).toHaveBeenCalledWith({
      name: 'AKIN OLA',
      accountNumber: '0123456789',
      bankCode: '058',
    });
    expect(paystackMock.initiateTransfer).toHaveBeenCalledWith({
      amount: 50000,
      recipientCode: 'RCP_new123',
      reason: expect.stringContaining('GymFlow payout'),
      reference: 'pay-1', // idempotency key — must be the payout id
    });

    expect(auditMock).toHaveBeenCalledTimes(1);
    const auditArg = auditMock.mock.calls[0]![0];
    if (!auditArg.after) throw new Error('audit was called without after');
    expect(auditArg.action).toBe('admin.payout_processed');
    expect(auditArg.after.paystack_transfer_code).toBe('TRF_abc');
    // PII redaction: only last 4 digits of account in audit log.
    expect(auditArg.after.account_number_last4).toBe('6789');
    expect(auditArg.after).not.toHaveProperty('account_number');
  });

  it('reuses an existing recipient_code if the same coach+account was paid before', async () => {
    state.client = createMockSupabase([
      { data: { id: 'pay-2', gym_id: 'gym-1', instructor_id: 'coach-1', amount: 30000, status: 'requested' }, error: null },
      // Prior payout had this recipient — must NOT create a new one.
      { data: { paystack_recipient_code: 'RCP_existing999' }, error: null },
      { data: null, error: null },
    ]);

    const r = await processPayout('demo', 'pay-2', formData({
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '0123456789',
    }));

    expect(r.ok).toBe(true);
    expect(paystackMock.createTransferRecipient).not.toHaveBeenCalled();
    expect(paystackMock.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({
      recipientCode: 'RCP_existing999',
    }));
  });

  it('aborts BEFORE creating a recipient if resolveAccount fails', async () => {
    state.client = createMockSupabase([
      { data: { id: 'pay-1', gym_id: 'gym-1', instructor_id: 'coach-1', amount: 50000, status: 'requested' }, error: null },
    ]);
    paystackMock.resolveAccount.mockRejectedValueOnce(new Error('Account name not found'));

    const r = await processPayout('demo', 'pay-1', formData({
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '0123456789',
    }));

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not resolve/);
    expect(paystackMock.createTransferRecipient).not.toHaveBeenCalled();
    expect(paystackMock.initiateTransfer).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('aborts BEFORE updating the row if initiateTransfer fails — DB stays in requested', async () => {
    state.client = createMockSupabase([
      { data: { id: 'pay-1', gym_id: 'gym-1', instructor_id: 'coach-1', amount: 50000, status: 'requested' }, error: null },
      { data: null, error: null },
    ]);
    paystackMock.initiateTransfer.mockRejectedValueOnce(new Error('Insufficient balance'));

    const r = await processPayout('demo', 'pay-1', formData({
      bank_code: '058',
      bank_name: 'GTBank',
      account_number: '0123456789',
    }));

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Transfer failed.*Insufficient/);
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('rejectPayout', () => {
  it('flips a requested payout to rejected and audits', async () => {
    state.client = createMockSupabase([
      { data: { id: 'pay-1', gym_id: 'gym-1', instructor_id: 'coach-1', status: 'requested', amount: 50000 }, error: null },
      { data: null, error: null },
    ]);

    const r = await rejectPayout('demo', 'pay-1', 'Insufficient earnings');
    expect(r.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledTimes(1);
    const auditArg = auditMock.mock.calls[0]![0];
    if (!auditArg.after) throw new Error('audit was called without after');
    expect(auditArg.action).toBe('admin.payout_rejected');
    expect(auditArg.after).toMatchObject({ status: 'rejected', reason: 'Insufficient earnings' });
  });

  it('refuses to reject a payout already paid', async () => {
    state.client = createMockSupabase([
      { data: { id: 'pay-1', gym_id: 'gym-1', instructor_id: 'coach-1', status: 'paid', amount: 50000 }, error: null },
    ]);
    const r = await rejectPayout('demo', 'pay-1', 'oops');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already paid/);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('returns "Payout not found" when the id is unknown', async () => {
    state.client = createMockSupabase([
      { data: null, error: null },
    ]);
    const r = await rejectPayout('demo', 'nope', 'reason');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Payout not found');
  });
});

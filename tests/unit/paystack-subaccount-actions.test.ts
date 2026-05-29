import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// lib/actions/paystack-subaccount.ts — connects a gym's settlement bank
// account to Paystack so member payments route to the right place. Every
// function is requireManager-gated: the comment in the source notes that
// without it verifyAccountName would be an open account-number → name lookup
// oracle (privacy leak + Paystack cost abuse). Invariants locked:
//   - all three functions delegate authz to requireManager
//   - account name is resolved/verified BEFORE any Paystack subaccount
//     mutation (a bad NUBAN can't create a subaccount pointing nowhere)
//   - first-time connect creates a subaccount and persists its code; a
//     re-connect (existing code present) UPDATES instead of creating a
//     duplicate
//   - the gym bank columns + audit row are written with the right action
//     string per branch

const { state, requireManagerMock, getSessionMock, paystack } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    gym: Record<string, unknown>;
    updates: Array<{ payload: Record<string, unknown>; eqs: EqCall[] }>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  } = { gym: {}, updates: [], inserts: [] };

  const requireManagerMock = vi.fn(async (slug: string) => { void slug; return { role: 'gym_owner', gym: state.gym }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const paystack = {
    listBanks: vi.fn(async () => [{ code: '058', name: 'GTBank', slug: 'gtb', longcode: '058' }]),
    resolveAccount: vi.fn(async () => ({ account_number: '0123456789', account_name: 'ADA LOVELACE' })),
    createSubaccount: vi.fn(async () => ({ subaccount_code: 'ACCT_new', business_name: 'Iron Temple' })),
    updateSubaccount: vi.fn(async () => ({ subaccount_code: 'ACCT_existing', business_name: 'Iron Temple' })),
  };
  return { state, requireManagerMock, getSessionMock, paystack };
});

function makeAdmin() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      const builder = {
        _payload: null as Record<string, unknown> | null,
        update(p: Record<string, unknown>) { builder._payload = p; return builder; },
        insert(p: Record<string, unknown>) { state.inserts.push({ table, payload: p }); return Promise.resolve({ error: null }); },
        eq(col: string, val: unknown) {
          eqs.push({ col, val });
          if (table === 'gyms') state.updates.push({ payload: builder._payload!, eqs: [...eqs] });
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdmin() }));
vi.mock('@/lib/auth/gym', () => ({ requireManager: requireManagerMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/paystack', () => paystack);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { fetchBanks, verifyAccountName, connectPaystackSubaccount } from '@/lib/actions/paystack-subaccount';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

const GYM_NEW = { id: 'gym-1', name: 'Iron Temple', email: 'g@e.com', phone: '+234', platform_commission_pct: 5, paystack_subaccount_code: null };
const GYM_CONNECTED = { ...GYM_NEW, paystack_subaccount_code: 'ACCT_existing' };

beforeEach(() => {
  state.gym = { ...GYM_NEW };
  state.updates = [];
  state.inserts = [];
  requireManagerMock.mockClear();
  paystack.listBanks.mockClear();
  paystack.resolveAccount.mockClear();
  paystack.createSubaccount.mockClear();
  paystack.updateSubaccount.mockClear();
  paystack.resolveAccount.mockResolvedValue({ account_number: '0123456789', account_name: 'ADA LOVELACE' });
});

describe('fetchBanks', () => {
  it('requires manager auth before hitting Paystack', async () => {
    requireManagerMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(fetchBanks('demo')).rejects.toThrow();
    expect(paystack.listBanks).not.toHaveBeenCalled();
  });

  it('returns a trimmed {code,name} list', async () => {
    const r = await fetchBanks('demo');
    expect(r.ok).toBe(true);
    expect(r.banks).toEqual([{ code: '058', name: 'GTBank' }]);
  });

  it('surfaces a Paystack error', async () => {
    paystack.listBanks.mockRejectedValueOnce(new Error('Paystack 503'));
    const r = await fetchBanks('demo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/503/);
  });
});

describe('verifyAccountName (manager-gated lookup — not an open oracle)', () => {
  it('requires manager auth before resolving', async () => {
    requireManagerMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(verifyAccountName('demo', fd({ account_number: '0123456789', bank_code: '058' }))).rejects.toThrow();
    expect(paystack.resolveAccount).not.toHaveBeenCalled();
  });

  it('rejects a non-10-digit account number without calling Paystack', async () => {
    const r = await verifyAccountName('demo', fd({ account_number: '123', bank_code: '058' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10 digits/);
    expect(paystack.resolveAccount).not.toHaveBeenCalled();
  });

  it('rejects a missing bank code', async () => {
    const r = await verifyAccountName('demo', fd({ account_number: '0123456789', bank_code: '' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bank required/);
  });

  it('returns the resolved account name on success', async () => {
    const r = await verifyAccountName('demo', fd({ account_number: '0123456789', bank_code: '058' }));
    expect(r.ok).toBe(true);
    expect(r.accountName).toBe('ADA LOVELACE');
  });
});

describe('connectPaystackSubaccount — validation + verification', () => {
  it('requires manager auth', async () => {
    requireManagerMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(connectPaystackSubaccount('demo', fd({ account_number: '0123456789', bank_code: '058' }))).rejects.toThrow();
    expect(paystack.createSubaccount).not.toHaveBeenCalled();
  });

  it('rejects a bad account number before any Paystack call', async () => {
    const r = await connectPaystackSubaccount('demo', fd({ account_number: 'abc', bank_code: '058' }));
    expect(r.ok).toBe(false);
    expect(paystack.resolveAccount).not.toHaveBeenCalled();
    expect(paystack.createSubaccount).not.toHaveBeenCalled();
  });

  it('aborts BEFORE creating the subaccount if account verification fails', async () => {
    paystack.resolveAccount.mockRejectedValueOnce(new Error('account not found'));
    const r = await connectPaystackSubaccount('demo', fd({ account_number: '0123456789', bank_code: '058' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/verification failed.*account not found/);
    expect(paystack.createSubaccount).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0); // no audit
  });
});

describe('connectPaystackSubaccount — first-time connect', () => {
  it('creates a subaccount, persists its code, writes bank cols, audits subaccount_created', async () => {
    const r = await connectPaystackSubaccount('demo', fd({ account_number: '0123456789', bank_code: '058', bank_name: 'GTBank' }));
    expect(r.ok).toBe(true);
    expect(paystack.createSubaccount).toHaveBeenCalledTimes(1);
    expect(paystack.updateSubaccount).not.toHaveBeenCalled();
    // The new subaccount code is persisted onto the gym.
    expect(state.updates.some((u) => u.payload.paystack_subaccount_code === 'ACCT_new')).toBe(true);
    // Bank columns written with the Paystack-verified account name.
    const bankUpdate = state.updates.find((u) => u.payload.account_name === 'ADA LOVELACE')!;
    expect(bankUpdate.payload).toMatchObject({ bank_code: '058', bank_name: 'GTBank', account_number: '0123456789' });
    const audit = state.inserts.find((i) => i.table === 'audit_logs')!;
    expect(audit.payload.action).toBe('admin.subaccount_created');
  });

  it('passes the gym commission into createSubaccount', async () => {
    state.gym = { ...GYM_NEW, platform_commission_pct: 7 };
    await connectPaystackSubaccount('demo', fd({ account_number: '0123456789', bank_code: '058' }));
    expect(paystack.createSubaccount).toHaveBeenCalledWith(expect.objectContaining({ percentageCharge: 7 }));
  });
});

describe('connectPaystackSubaccount — re-connect (existing code)', () => {
  it('UPDATES the existing subaccount instead of creating a duplicate, audits subaccount_updated', async () => {
    state.gym = { ...GYM_CONNECTED };
    const r = await connectPaystackSubaccount('demo', fd({ account_number: '0123456789', bank_code: '058' }));
    expect(r.ok).toBe(true);
    expect(paystack.updateSubaccount).toHaveBeenCalledTimes(1);
    expect(paystack.updateSubaccount).toHaveBeenCalledWith('ACCT_existing', expect.objectContaining({ bankCode: '058' }));
    expect(paystack.createSubaccount).not.toHaveBeenCalled();
    const audit = state.inserts.find((i) => i.table === 'audit_logs')!;
    expect(audit.payload.action).toBe('admin.subaccount_updated');
  });

  it('surfaces a Paystack failure on the update path and does not audit', async () => {
    state.gym = { ...GYM_CONNECTED };
    paystack.updateSubaccount.mockRejectedValueOnce(new Error('subaccount locked'));
    const r = await connectPaystackSubaccount('demo', fd({ account_number: '0123456789', bank_code: '058' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Paystack: subaccount locked/);
    expect(state.inserts).toHaveLength(0);
  });
});

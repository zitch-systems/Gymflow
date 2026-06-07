import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file — declared mock fns must be
// defined via vi.hoisted so they exist when the factory runs.
const { getSessionUserMock, getGymBySlugMock, getStaffRoleMock } = vi.hoisted(() => ({
  getSessionUserMock: vi.fn(),
  getGymBySlugMock: vi.fn(),
  getStaffRoleMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({
  getSessionUser: getSessionUserMock,
}));
vi.mock('@/lib/auth/gym', () => ({
  getGymBySlug: getGymBySlugMock,
  getStaffRole: getStaffRoleMock,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({}) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { checkInBySlug } from '@/lib/actions/checkin';

beforeEach(() => {
  vi.clearAllMocks();
  getGymBySlugMock.mockResolvedValue({ id: 'gym-1', slug: 'demo' });
});

describe('checkInBySlug — authorization', () => {
  it('rejects unauthenticated callers', async () => {
    getSessionUserMock.mockResolvedValue(null);
    const r = await checkInBySlug('demo', 'member-1', { method: 'self' });
    expect(r).toEqual({ ok: false, error: 'Not signed in' });
  });

  it('blocks manual check-in by a non-staff caller', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'random-user' });
    getStaffRoleMock.mockResolvedValue(null);
    const r = await checkInBySlug('demo', 'victim-id', { method: 'manual' });
    expect(r).toEqual({ ok: false, error: 'Not authorized' });
  });

  it('blocks manual check-in when the caller is only a member (not staff)', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'just-member' });
    getStaffRoleMock.mockResolvedValue('member');
    const r = await checkInBySlug('demo', 'victim-id', { method: 'manual' });
    expect(r).toEqual({ ok: false, error: 'Not authorized' });
  });

  it('rejects self check-in when memberId is not the caller', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'attacker' });
    const r = await checkInBySlug('demo', 'victim-id', { method: 'self' });
    expect(r).toEqual({ ok: false, error: 'Not authorized' });
  });

  it('rejects QR check-in when memberId is not the caller', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'attacker' });
    const r = await checkInBySlug('demo', 'victim-id', { method: 'qr' });
    expect(r).toEqual({ ok: false, error: 'Not authorized' });
  });

  it('default method is manual → requires staff (no implicit self-check-in fallback)', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'random-user' });
    getStaffRoleMock.mockResolvedValue(null);
    const r = await checkInBySlug('demo', 'victim-id');
    expect(r).toEqual({ ok: false, error: 'Not authorized' });
  });
});

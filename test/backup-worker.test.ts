import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  run: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  health: vi.fn(),
  started: vi.fn(),
  succeeded: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({ cronAuthorized: () => true }));
vi.mock('@/lib/backup-run', () => ({ runGymBackup: calls.run }));
vi.mock('@/lib/backup-queue', () => ({
  claimDueBackupJobs: calls.claim,
  finishBackupJob: calls.finish,
  backupQueueHealth: calls.health,
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ kind: 'admin' }) }));
vi.mock('@/lib/server-error', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/operational-jobs', () => ({
  markJobStarted: calls.started,
  markJobSucceeded: calls.succeeded,
  markJobFailed: vi.fn(),
}));

import { GET } from '@/app/api/cron/backups/route';

describe('backup queue worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.claim.mockResolvedValue({
      lockToken: 'lock_fixture',
      jobs: [{
        gym_id: 'gym_offline', gym_name: 'Offline Gym', gym_status: 'suspended',
        backup_frequency: 'daily', backup_email: true, attempts: 1,
        due_at: '2026-10-01T00:00:00.000Z',
      }],
    });
    calls.finish.mockResolvedValue(undefined);
    calls.health.mockResolvedValue({ queued: 0, oldestDueAt: null });
    calls.started.mockResolvedValue(undefined);
    calls.succeeded.mockResolvedValue(undefined);
  });

  it('drops a claimed job when the gym was suspended after enqueue', async () => {
    const response = await GET(new Request('https://gymflow.invalid/api/cron/backups'));

    expect(response.status).toBe(200);
    expect(calls.run).not.toHaveBeenCalled();
    expect(calls.finish).toHaveBeenCalledWith(
      { kind: 'admin' },
      expect.objectContaining({ gym_id: 'gym_offline', gym_status: 'suspended' }),
      'lock_fixture',
      { complete: true },
    );
    expect(await response.json()).toMatchObject({ ok: true, claimed: 1, completed: 0 });
  });
});

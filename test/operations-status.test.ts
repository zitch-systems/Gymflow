import { describe, expect, it } from 'vitest';
import { jobDisplayStatus } from '../lib/operations-status';

const now = Date.parse('2026-10-03T12:00:00Z');

describe('operations job display status', () => {
  it('fails closed when a scheduled job has never succeeded or is missing', () => {
    expect(jobDisplayStatus('notifications', undefined, now).label).toBe('Never run');
    expect(jobDisplayStatus('gym_backups', { last_succeeded_at: null, consecutive_failures: 0 }, now).label)
      .toBe('Never run');
  });

  it('shows failures before freshness', () => {
    expect(jobDisplayStatus('payment_webhook_recovery', {
      last_succeeded_at: '2026-10-03T11:59:00Z', consecutive_failures: 2,
    }, now)).toEqual({ label: '2 failed', tone: 'danger' });
  });

  it('uses grace windows derived from each cron frequency', () => {
    expect(jobDisplayStatus('gym_backups', {
      last_succeeded_at: '2026-10-03T11:29:59Z', consecutive_failures: 0,
    }, now).label).toBe('Overdue');
    expect(jobDisplayStatus('paystack_reconciliation', {
      last_succeeded_at: '2026-10-03T11:31:00Z', consecutive_failures: 0,
    }, now).label).toBe('Healthy');
    expect(jobDisplayStatus('payment_webhook_recovery', {
      last_succeeded_at: '2026-10-03T11:49:59Z', consecutive_failures: 0,
    }, now).label).toBe('Overdue');
    expect(jobDisplayStatus('notifications', {
      last_succeeded_at: '2026-10-02T09:59:59Z', consecutive_failures: 0,
    }, now).label).toBe('Overdue');
  });

  it('rejects malformed success timestamps', () => {
    expect(jobDisplayStatus('notifications', {
      last_succeeded_at: 'not-a-date', consecutive_failures: 0,
    }, now)).toEqual({ label: 'Invalid timestamp', tone: 'danger' });
  });
});

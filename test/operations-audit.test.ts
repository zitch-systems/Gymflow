import { describe, expect, it, vi } from 'vitest';
import { errorClass, incidentKind, operationsSnapshot, safeLabel } from '../scripts/operations-audit.mjs';

describe('operations audit output safety', () => {
  it('classifies errors without returning their sensitive text', () => {
    expect(errorClass('Paystack verification failed for ref_customer_secret')).toBe('provider');
    expect(errorClass('password=hunter2 unauthorized 401')).toBe('authentication');
    expect(errorClass('AES authentication tag could not decrypt payload')).toBe('payload_decryption');
  });

  it('accepts catalog labels and replaces unsafe labels', () => {
    expect(safeLabel('paystack_reconciliation')).toBe('paystack_reconciliation');
    expect(safeLabel('customer@example.com')).toBe('unclassified');
    expect(incidentKind('reconciliation: Paystack charges missing locally')).toBe('provider_charge_missing_locally');
    expect(incidentKind('provider failed for private-customer-reference')).toBe('unclassified_incident');
  });

  it('uses a read-only transaction, emits aggregates, and always rolls back', async () => {
    const responses = [
      [], [], [], [],
      [{ job_name: 'notifications', last_started_at: null, last_heartbeat_at: null, last_succeeded_at: null,
        watermark: null, consecutive_failures: '2', has_error: true, last_error: 'timeout ref-secret' }],
      [{ kind: 'paystack recovery requires operator repair', error: 'provider failed ref-secret', attempts: '3',
        has_reference: true, member_payment_exists: true, affected_count: '1', recovery_pending: true,
        first_seen_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-02T00:00:00Z' }],
      [{ webhook_due: '1', webhook_processing: '0', webhook_dead: '0', webhook_oldest: null,
        backup_due: '0', backup_processing: '0', backup_oldest_due: '2026-10-02T00:00:00Z' }],
      [{ payment_month: '2026-09-01', payment_method: 'card', has_plan_id: true, plan_exists: true, legacy_path: true,
        has_checkout: false, has_staff_operation: false, has_staff_commit_audit: false,
        has_coverage_metadata: false, has_refund_event: false, payment_count: '10' }],
      [{ payment_month: '2026-08-01', plan: 'starter', legacy_path: true, has_billing_period: true,
        valid_billing_period: true, has_refund_event: false, payment_count: '4' }],
    ];
    const query = vi.fn().mockImplementation(async () => ({ rows: responses.shift() ?? [] }));
    const snapshot = await operationsSnapshot({ query });
    expect(query.mock.calls[0][0]).toBe('begin read only');
    expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');
    expect(snapshot.jobs[0]).toMatchObject({ job_name: 'notifications', consecutive_failures: 2, error_class: 'timeout' });
    expect(snapshot.incidents[0]).toMatchObject({ kind: 'webhook_operator_repair', error_class: 'provider', open_count: 1, total_attempts: 3,
      with_reference: 1, with_member_payment: 1, affected_count: 1, with_recovery_pending: 1, with_recovery_completed: 0 });
    expect(snapshot.unallocated_member_payments[0].payment_count).toBe(10);
    expect(snapshot.queues.backup_oldest_due).toBe('2026-10-02T00:00:00Z');
    expect(JSON.stringify(snapshot)).not.toContain('ref-secret');
  });

  it('rolls back a failed read without masking it as an empty report', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    query.mockImplementationOnce(async () => ({ rows: [] }));
    query.mockImplementationOnce(async () => { throw new Error('read failed'); });
    await expect(operationsSnapshot({ query })).rejects.toThrow('read failed');
    expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');
  });
});

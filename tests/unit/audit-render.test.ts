import { describe, it, expect } from 'vitest';
import { actionLabel, renderAuditDelta, fmtAuditValue } from '@/lib/audit-render';

describe('audit-render — actionLabel', () => {
  it('translates known actions to a human label', () => {
    expect(actionLabel('admin.plan_updated')).toBe('Updated plan');
    expect(actionLabel('admin.equipment_deleted')).toBe('Removed equipment');
    expect(actionLabel('member.pause_requested')).toBe('Requested pause');
  });

  it('title-cases unknown actions instead of crashing', () => {
    expect(actionLabel('admin.brand_new_thing')).toBe('Admin.brand new thing');
    expect(actionLabel('whatever')).toBe('Whatever');
  });
});

describe('audit-render — fmtAuditValue', () => {
  it('truncates long strings at 40 chars', () => {
    expect(fmtAuditValue('a'.repeat(50))).toMatch(/…$/);
    expect(fmtAuditValue('a'.repeat(50)).length).toBe(38);
  });

  it('renders null/undefined as a single glyph', () => {
    expect(fmtAuditValue(null)).toBe('∅');
    expect(fmtAuditValue(undefined)).toBe('∅');
  });

  it('JSON-stringifies objects so nested values still print', () => {
    expect(fmtAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('audit-render — renderAuditDelta', () => {
  it('returns only the changed keys for an update', () => {
    const before = { name: 'Monthly', price: 20000, is_active: true };
    const after = { name: 'Monthly', price: 22000, is_active: true };
    const delta = renderAuditDelta(before, after);
    expect(delta.rows).toEqual([{ key: 'price', from: '20000', to: '22000' }]);
  });

  it('treats inserts as one-sided (from is empty)', () => {
    const after = { name: 'New plan', price: 5000 };
    const delta = renderAuditDelta(null, after);
    expect(delta.rows).toEqual([
      { key: 'name', from: '', to: 'New plan' },
      { key: 'price', from: '', to: '5000' },
    ]);
  });

  it('treats deletes as one-sided (only before is populated)', () => {
    const before = { name: 'Old plan' };
    const delta = renderAuditDelta(before, null);
    expect(delta.rows).toEqual([{ key: 'name', from: '', to: 'Old plan' }]);
  });

  it('returns no rows + raw for a primitive payload', () => {
    const delta = renderAuditDelta(null, 'a string');
    expect(delta.rows).toHaveLength(0);
    expect(delta.raw).toBe('"a string"');
  });

  it('handles a key being added between before and after', () => {
    const before = { name: 'X' };
    const after = { name: 'X', description: 'now we have a description' };
    const delta = renderAuditDelta(before, after);
    expect(delta.rows).toEqual([
      { key: 'description', from: '∅', to: 'now we have a description' },
    ]);
  });
});

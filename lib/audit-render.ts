// Shared rendering helpers for the gym-admin and platform-admin audit pages.
// Both viewers display the same action strings (emitted by the audit() helper)
// and the same JSONB shape for old_values / new_values, so they share label
// translation, delta rendering, and value formatting.

// Human-readable label for each action string we emit. Falls back to a
// title-cased version of the raw action so newly-added actions still render
// without breaking the page.
const ACTION_LABEL: Record<string, string> = {
  'admin.member_onboarded': 'Onboarded member',
  'admin.pause_approved': 'Approved pause',
  'admin.resume': 'Resumed membership',
  'admin.extend_membership': 'Extended membership',
  'admin.cancel_membership': 'Cancelled membership',
  'admin.instructor_invited': 'Invited instructor',
  'admin.subaccount_created': 'Connected Paystack subaccount',
  'admin.subaccount_updated': 'Updated Paystack subaccount',
  'admin.plan_created': 'Created plan',
  'admin.plan_updated': 'Updated plan',
  'admin.plan_deleted': 'Deleted plan',
  'admin.equipment_created': 'Added equipment',
  'admin.equipment_updated': 'Updated equipment',
  'admin.equipment_deleted': 'Removed equipment',
  'admin.expense_created': 'Logged expense',
  'admin.expense_updated': 'Updated expense',
  'admin.expense_deleted': 'Deleted expense',
  'admin.class_created': 'Created class',
  'admin.class_deleted': 'Deleted class',
  'admin.business_hours_updated': 'Updated business hours',
  'admin.gym_active': 'Re-activated gym',
  'admin.gym_suspended': 'Suspended gym',
  'admin.gym_terminated': 'Terminated gym',
  'platform.gym_active': 'Re-activated gym (platform)',
  'platform.gym_suspended': 'Suspended gym (platform)',
  'platform.gym_terminated': 'Terminated gym (platform)',
  'member.pause_requested': 'Requested pause',
  'member.cancel_at_period_end': 'Cancelled at period end',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function fmtAuditValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 37) + '…' : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export type Delta = {
  rows: Array<{ key: string; from: string; to: string }>;
  raw: string | null;
};

// Compact before → after delta for updates. For inserts and deletes only one
// side is populated, so we just show the relevant set.
export function renderAuditDelta(before: unknown, after: unknown): Delta {
  if (typeof before === 'object' && before !== null && typeof after === 'object' && after !== null) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
    const changed = keys
      .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .map((k) => ({ key: k, from: fmtAuditValue(b[k]), to: fmtAuditValue(a[k]) }));
    return { rows: changed, raw: null };
  }
  const side = after ?? before;
  if (typeof side === 'object' && side !== null) {
    const s = side as Record<string, unknown>;
    return {
      rows: Object.entries(s).map(([k, v]) => ({ key: k, from: '', to: fmtAuditValue(v) })),
      raw: null,
    };
  }
  return { rows: [], raw: side != null ? JSON.stringify(side) : null };
}

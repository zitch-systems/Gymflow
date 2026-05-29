'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireManager } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { audit } from '@/lib/audit';
import { actionLabel } from '@/lib/audit-render';

export type AuditCsvResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; error: string };

// Allowlists for the URL-supplied filter knobs. Anything outside these falls
// through to the safe default ('all' / 30 days) — there's no DB cost since
// we just clamp instead of erroring.
export const AUDIT_EXPORT_SCOPES = {
  all:         { prefix: null,                label: 'All events' },
  plans:       { prefix: 'admin.plan_',       label: 'Plans' },
  members:     { prefix: 'admin.member_',     label: 'Members' },
  instructors: { prefix: 'admin.instructor_', label: 'Instructors' },
  classes:     { prefix: 'admin.class_',      label: 'Classes' },
  equipment:   { prefix: 'admin.equipment_',  label: 'Equipment' },
  expenses:    { prefix: 'admin.expense_',    label: 'Expenses' },
  billing:     { prefix: 'admin.subaccount_', label: 'Billing' },
  payouts:     { prefix: 'admin.payout_',     label: 'Payouts' },
} as const;
export type AuditExportScope = keyof typeof AUDIT_EXPORT_SCOPES;

const AUDIT_EXPORT_WINDOWS = { '7': 7, '30': 30, '90': 90 } as const;
type AuditExportWindow = keyof typeof AUDIT_EXPORT_WINDOWS;

const DAY_MS = 86_400_000;

const COLUMNS = ['timestamp', 'actor_name', 'actor_email', 'action', 'action_label', 'table_name', 'record_id', 'old_values', 'new_values'] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Export the gym's audit log as a CSV. Honours the same scope + window
 * filters as the viewer page so "what I see is what I download." Manager-only
 * (matches the viewer) and double-audited: exporting the log is itself an
 * audit entry, so an attacker can't quietly pull the data.
 */
export async function exportAuditCsv(
  slug: string,
  scopeId: string,
  daysId: string,
): Promise<AuditCsvResult> {
  const { gym } = await requireManager(slug);
  const actor = await getSessionUser();

  const scope = (Object.prototype.hasOwnProperty.call(AUDIT_EXPORT_SCOPES, scopeId)
    ? AUDIT_EXPORT_SCOPES[scopeId as AuditExportScope]
    : AUDIT_EXPORT_SCOPES.all);
  const days = (Object.prototype.hasOwnProperty.call(AUDIT_EXPORT_WINDOWS, daysId)
    ? AUDIT_EXPORT_WINDOWS[daysId as AuditExportWindow]
    : 30);

  const supabase = createAdminClient();
  const since = new Date(Date.now() - days * DAY_MS).toISOString();

  let q = supabase
    .from('audit_logs')
    .select('id, created_at, action, table_name, record_id, actor_id, old_values, new_values')
    .eq('gym_id', gym.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (scope.prefix) q = q.ilike('action', `${scope.prefix}%`);
  const { data: rows } = await q;

  // Batched actor lookup so the CSV shows readable names instead of uuids.
  const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter((id): id is string => !!id)));
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, email').in('id', actorIds)
    : { data: [] };
  const actorById = new Map((actors ?? []).map((a) => [a.id, a]));

  const lines: string[] = [COLUMNS.join(',')];
  for (const r of rows ?? []) {
    const ac = r.actor_id ? actorById.get(r.actor_id) : null;
    const actorName = ac?.full_name ?? ac?.first_name ?? '';
    lines.push(
      [
        csvCell(r.created_at),
        csvCell(actorName),
        csvCell(ac?.email),
        csvCell(r.action),
        csvCell(actionLabel(r.action)),
        csvCell(r.table_name),
        csvCell(r.record_id),
        csvCell(r.old_values),
        csvCell(r.new_values),
      ].join(','),
    );
  }

  const csv = lines.join('\n');
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${gym.slug}-audit-${scope === AUDIT_EXPORT_SCOPES.all ? 'all' : scopeId}-${days}d-${stamp}.csv`;
  const exportedRows = lines.length - 1;

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.audit_exported',
    table: 'audit_logs',
    after: { row_count: exportedRows, filename, scope: scopeId, days },
  });

  return { ok: true, filename, csv, rows: exportedRows };
}

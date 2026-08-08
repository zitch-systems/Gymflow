import 'server-only';
import { zipSync, strToU8 } from 'fflate';
import { createAdminClient } from '@/lib/supabase/admin';
import { toCsv } from '@/lib/csv';
import { backupFilename, EXCLUDED_TABLES } from '@/lib/backup-plan';

// Scheduling, naming and the exclusion list live in lib/backup-plan.ts — pure,
// so the suite can exercise them without a server-only import. Re-exported here
// so callers have one import for "backups".
export {
  backupDue, backupFilename, backupStoragePath, humanSize,
  EXCLUDED_TABLES, KEEP_BACKUPS, type BackupFrequency,
} from '@/lib/backup-plan';

// Building a gym's data backup: a zip of one CSV per table, plus a manifest.
//
// Shape of the thing: CSVs rather than a SQL dump because the audience is a gym
// owner, not a DBA — the failure this guards against is "GymFlow went away" or
// "we deleted something we shouldn't have", and both are answered by opening
// the file in a spreadsheet. lib/csv.ts does the escaping, including the
// formula-injection guard, so a member named `=HYPERLINK(...)` can't execute in
// whoever opens the archive.

// ── What goes in, and what deliberately does not ──────────────────────────
//
// The gym's operating record. Each entry is a table plus the columns worth
// keeping — `select *` would rot silently as columns are added, and would drag
// in whatever sensitive column someone adds next.
const TABLES: { table: string; label: string; columns: string; order?: string }[] = [
  { table: 'membership_plans', label: 'plans', columns: 'id, name, description, price, currency, duration_months, duration_days, is_active, trainer_addon_enabled, trainer_addon_price, created_at', order: 'created_at' },
  { table: 'gym_member_links', label: 'members', columns: 'id, user_id, member_id, joined_at, is_active', order: 'joined_at' },
  { table: 'member_subscriptions', label: 'subscriptions', columns: 'id, member_id, plan_id, status, start_date, end_date, auto_debit_enabled, trainer_addon, payment_method, created_at', order: 'created_at' },
  { table: 'memberships', label: 'memberships', columns: 'id, member_id, plan_id, status, start_date, end_date, auto_renew, payment_method, created_at', order: 'created_at' },
  { table: 'payments', label: 'payments', columns: 'id, member_id, plan_id, amount, currency, status, payment_status, payment_method, paystack_reference, payment_date, created_at', order: 'payment_date' },
  { table: 'check_ins', label: 'check-ins', columns: 'id, member_id, status, check_in_method, checked_in_at, checked_out_at', order: 'checked_in_at' },
  { table: 'classes', label: 'classes', columns: 'id, name, category, max_capacity, duration_minutes, is_active, created_at', order: 'created_at' },
  { table: 'class_schedules', label: 'class-schedules', columns: 'id, class_id, day_of_week, start_time, end_time, room, is_active', order: 'day_of_week' },
  { table: 'class_bookings', label: 'class-bookings', columns: 'id, member_id, class_id, class_schedule_id, booking_date, status, checked_in, booked_at', order: 'booked_at' },
  { table: 'gym_staff_links', label: 'staff', columns: 'id, user_id, role, is_active, joined_at', order: 'joined_at' },
  { table: 'instructor_subscriptions', label: 'personal-training', columns: 'id, instructor_id, member_id, plan_id, status, start_date, end_date, amount_paid, created_at', order: 'created_at' },
  { table: 'instructor_sessions', label: 'pt-sessions', columns: 'id, instructor_id, member_id, status, marked_at', order: 'marked_at' },
  { table: 'instructor_payouts', label: 'instructor-payouts', columns: 'id, instructor_id, amount, status, requested_at, notes', order: 'requested_at' },
  { table: 'business_hours', label: 'business-hours', columns: 'id, day_of_week, open_time, close_time, is_closed', order: 'day_of_week' },
  { table: 'expenses', label: 'expenses', columns: '*', order: 'created_at' },
  { table: 'equipment', label: 'equipment', columns: '*', order: 'created_at' },
  { table: 'waiver_signatures', label: 'waiver-signatures', columns: '*', order: 'created_at' },
];

// Per-table row ceiling. A backup is a safety net, not an archive service: an
// unbounded select on a busy gym's check_ins would exhaust the function's
// memory and produce no backup at all, which is the one outcome worse than a
// truncated one. Truncation is recorded in the manifest so it is never silent.
const MAX_ROWS = 50_000;

export type BackupTableResult = { label: string; rows: number; truncated: boolean; error?: string };

/**
 * Minimal shape of a PostgREST query builder, so the table name can be a
 * variable.
 *
 * The generated Database type keys `.from()` on a literal union, which is what
 * makes every hand-written query safe — but this loop is deliberately generic
 * over a table list, so it cannot satisfy that. Narrowing the escape hatch to
 * this interface keeps the chain typed and the results explicitly `unknown`,
 * rather than casting the whole client to `any` and losing both.
 */
type LooseResult = { data: unknown; error: { message: string } | null };
type LooseQuery = PromiseLike<LooseResult> & {
  select: (columns: string) => LooseQuery;
  eq: (column: string, value: string) => LooseQuery;
  limit: (n: number) => LooseQuery;
  order: (column: string, opts: { ascending: boolean }) => LooseQuery;
};
type LooseFrom = { from: (table: string) => LooseQuery };

export type BackupArchive = {
  bytes: Uint8Array;
  filename: string;
  rowCounts: Record<string, number>;
  tables: BackupTableResult[];
  /** Tables that failed to read. The archive is still produced — a backup
   *  missing one table beats no backup — but the manifest and the log say so. */
  failures: string[];
};

/** Rows → header + matrix, with objects/arrays flattened to JSON so a jsonb
 *  column lands as readable text rather than "[object Object]". */
function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const header = Object.keys(rows[0]);
  const body = rows.map((r) => header.map((h) => {
    const v = r[h];
    if (v == null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : v;
  }));
  return toCsv(header, body);
}

/**
 * Build the archive for one gym. Service-role: this deliberately reads across
 * every member of the gym, which no user-scoped client can do.
 *
 * Never throws for a single table's sake — a gym with one unreadable table
 * still gets the other sixteen, and the manifest names what is missing.
 */
export async function buildGymBackup(gymId: string, gymName: string | null, now: Date = new Date()): Promise<BackupArchive> {
  const admin = createAdminClient();
  const loose = admin as unknown as LooseFrom;
  const files: Record<string, Uint8Array> = {};
  const rowCounts: Record<string, number> = {};
  const tables: BackupTableResult[] = [];
  const failures: string[] = [];

  for (const spec of TABLES) {
    try {
      let q = loose.from(spec.table).select(spec.columns).eq('gym_id', gymId).limit(MAX_ROWS);
      if (spec.order) q = q.order(spec.order, { ascending: true });
      const { data, error } = await q;
      if (error) {
        tables.push({ label: spec.label, rows: 0, truncated: false, error: error.message });
        failures.push(`${spec.label}: ${error.message}`);
        continue;
      }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      const truncated = rows.length >= MAX_ROWS;
      rowCounts[spec.label] = rows.length;
      tables.push({ label: spec.label, rows: rows.length, truncated });
      // An empty table still gets a file, with its header where possible: a
      // missing file reads as "we forgot to back this up", which is a worse
      // thing to believe than "there was nothing here".
      files[`${spec.label}.csv`] = strToU8(rowsToCsv(rows) || '(no rows)');
    } catch (e) {
      const msg = (e as Error).message;
      tables.push({ label: spec.label, rows: 0, truncated: false, error: msg });
      failures.push(`${spec.label}: ${msg}`);
    }
  }

  // The gym's own record — settings, branding, opening details. One row, so a
  // restore knows what it is restoring into.
  try {
    // Through `loose` for the same reason as above: joining_fee and
    // day_pass_price are live columns the checked-in generated types predate.
    const { data: gymRow } = await loose.from('gyms')
      .select('id, name, slug, email, phone, address, city, state, description, tagline, joining_fee, day_pass_price, created_at')
      .eq('id', gymId);
    const row = (gymRow as Record<string, unknown>[] | null)?.[0];
    if (row) files['gym.csv'] = strToU8(rowsToCsv([row]));
  } catch { /* the gym row is context, not the payload */ }

  const manifest = {
    gym: { id: gymId, name: gymName },
    generated_at: now.toISOString(),
    format: 'One CSV per table. Times are UTC.',
    tables: tables.map((t) => ({
      file: `${t.label}.csv`,
      rows: t.rows,
      ...(t.truncated ? { truncated_at: MAX_ROWS } : {}),
      ...(t.error ? { error: t.error } : {}),
    })),
    excluded: EXCLUDED_TABLES,
    note: 'Card details and bank account numbers are deliberately excluded — see "excluded" above.',
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  return {
    bytes: zipSync(files, { level: 6 }),
    filename: backupFilename(gymName, now),
    rowCounts,
    tables,
    failures,
  };
}

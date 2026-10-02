import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupArchive } from '@/lib/backup';
import { asSuperuser } from './db';

// One backup run end to end (lib/backup-run.ts) — specifically, what the run
// LEAVES BEHIND when it didn't fully work.
//
// buildGymBackup never throws for a single table's sake, which is right: a gym
// missing one table still wants the other sixteen. The consequence was that
// every degree of failure short of a thrown exception arrived here as an `ok`
// archive and was written down as `status: 'success'`. In the worst case every
// table failed, the archive was a manifest and nothing else, a few hundred
// bytes uploaded cleanly, and Settings → Backups showed a normal row — a
// scheduled job backing up nothing while looking healthy, which is strictly
// worse than backing up nothing loudly.
//
// The archive builder is substituted here (it has its own suite in
// test/backup-archive.test.ts); what is under test is the decision this module
// makes about what it was handed, and the row and the report that come out.

const captured = vi.hoisted(() => [] as Array<{ message: string; extra?: Record<string, unknown> }>);
const inserted = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const uploaded = vi.hoisted(() => [] as string[]);
const updated = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const deleted = vi.hoisted(() => [] as string[]);
const prunable = vi.hoisted(() => ({ success: [] as Array<{ id: string; storage_path: string | null }>, partial: [] as Array<{ id: string; storage_path: string | null }> }));
const removeFailure = vi.hoisted(() => ({ message: null as string | null }));
const archive = vi.hoisted(() => ({ current: null as unknown }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const backupTemplateArgs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@/lib/server-error', () => ({
  captureServerEvent: async (message: string, extra?: Record<string, unknown>) => { captured.push({ message, extra }); },
}));

vi.mock('@/lib/backup', () => ({ buildGymBackup: async () => archive.current }));

vi.mock('@/lib/email/recipients', () => ({ getGymOwnerEmails: async () => ['owner@example.test'] }));
vi.mock('@/lib/email/send', () => ({
  platformAppUrl: (path: string) => `https://gymflow.test${path}`,
  sendPlatformEmail: async (message: Record<string, unknown>) => { sent.push(message); return { ok: true }; },
}));
vi.mock('@/lib/email/templates/platform', () => ({
  gymBackupReady: (options: Record<string, unknown>) => {
    backupTemplateArgs.push(options);
    return { subject: 'Backup ready', preheader: 'Open your secure console', blocks: [] };
  },
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));

// Stand-in for the PostgREST call shapes this module uses. Every builder method
// returns the same object; awaiting it yields what that table/operation would.
function fakeAdmin() {
  function builder(table: string) {
    let op = 'select';
    let status = '';
    const q = {
      select() { return q; },
      insert(values: Record<string, unknown>) {
        op = 'insert';
        if (table === 'gym_backups') inserted.push(values);
        return q;
      },
      update(values: Record<string, unknown>) { op = 'update'; updated.push(values); return q; },
      delete() { op = 'delete'; return q; },
      eq(column: string, value: string) { if (column === 'status') status = value; return q; },
      in(_column: string, values: string[]) { if (op === 'delete') deleted.push(...values); return q; },
      order() { return q; },
      range() { return q; },
      async maybeSingle() {
        return { data: table === 'gyms' ? { id: GYM, name: 'Gym A', slug: 'gym-a' } : null, error: null };
      },
      then<T>(resolve: (v: { data: unknown; error: null }) => T) {
        const data = op === 'select' && table === 'gym_backups'
          ? prunable[status as keyof typeof prunable] ?? []
          : op === 'select' ? [] : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  }
  return {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        async upload(path: string) { uploaded.push(path); return { error: null }; },
        async remove() { return { error: removeFailure.message ? { message: removeFailure.message } : null }; },
      }),
    },
  };
}

const { runGymBackup } = await import('@/lib/backup-run');

const GYM = '11111111-1111-1111-1111-111111111111';

function madeArchive(over: Partial<BackupArchive>): BackupArchive {
  return {
    bytes: new Uint8Array(400),
    filename: 'backup-gym-a-2026-08-20.zip',
    rowCounts: {},
    tables: [],
    failures: [],
    warnings: [],
    ...over,
  };
}

beforeEach(() => {
  captured.length = 0;
  inserted.length = 0;
  uploaded.length = 0;
  updated.length = 0;
  deleted.length = 0;
  prunable.success = [];
  prunable.partial = [];
  removeFailure.message = null;
  sent.length = 0;
  backupTemplateArgs.length = 0;
  delete process.env.RESEND_API_KEY;
});

describe('a run where nothing could be read', () => {
  beforeEach(() => {
    archive.current = madeArchive({
      failures: ['members: permission denied', 'payments: permission denied'],
      rowCounts: {},
    });
  });

  it('is recorded as failed, not as a success with no rows', async () => {
    const res = await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].status).toBe('failed');
    expect(String(inserted[0].error)).toContain('no table could be read');
  });

  it('does not upload an empty archive that nobody should be offered', async () => {
    // A downloadable file listed as a good backup is the false confidence this
    // feature exists to remove.
    await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(uploaded).toEqual([]);
  });

  it('reports it, rather than only writing a row nobody opens', async () => {
    await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(captured.map((c) => c.message)).toContain('gym backup failed');
    expect(captured[0].extra).toMatchObject({ gymId: GYM, trigger: 'scheduled' });
  });
});

describe('a run that partly worked', () => {
  beforeEach(() => {
    archive.current = madeArchive({
      rowCounts: { members: 12, payments: 50_000 },
      failures: ['check-ins: permission denied'],
      warnings: ['payments: only the most recent 50,000 rows are included'],
    });
  });

  it('keeps the archive but writes what is wrong with it onto the row', async () => {
    // The email goes to whoever was an owner that day; the row is what is still
    // there months later, when someone is deciding whether to trust this file.
    const res = await runGymBackup(GYM, { trigger: 'manual', cadence: 'manual', email: false });
    expect(res.ok).toBe(true);
    expect(uploaded).toHaveLength(1);
    // A real table read failure downgrades the row to 'partial' — 'success'
    // is now reserved for runs where every requested table read cleanly. A
    // row-cap truncation warning (data is in the archive, just capped) does
    // NOT downgrade; only archive.failures do.
    expect(inserted[0].status).toBe('partial');
    expect(inserted[0].problems).toEqual([
      'check-ins: permission denied',
      'payments: only the most recent 50,000 rows are included',
    ]);
  });

  it('carries truncation to the caller alongside the read failures', async () => {
    const res = await runGymBackup(GYM, { trigger: 'manual', cadence: 'manual', email: false });
    expect(res.problems).toHaveLength(2);
    expect(res.problems.join(' ')).toContain('most recent 50,000');
  });

  it('is reported even though the run succeeded', async () => {
    await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(captured.map((c) => c.message)).toContain('gym backup completed with problems');
  });

  it('does not mark an incomplete archive as the last completed backup', async () => {
    await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(updated).toEqual([]);
  });

  it('retains only a bounded, independent window of partial archives', async () => {
    prunable.partial = [{ id: 'partial-old', storage_path: `${GYM}/partial-old.zip` }];
    await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(deleted).toContain('partial-old');
  });
});

describe('the column those problems are written to', () => {
  // The insert above is mocked, so this is the half that proves the write has
  // somewhere to land: a missing column would fail every backup log in
  // production and nowhere else.
  it('exists on gym_backups, defaulted so existing rows are already valid', async () => {
    const row = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'gym_backups' and column_name = 'problems'`,
      );
      return rows[0];
    });
    expect(row).toBeDefined();
    expect(row.data_type).toBe('ARRAY');
    expect(row.is_nullable).toBe('NO');
    expect(row.column_default).toContain('{}');
  });
});

describe('a clean run', () => {
  beforeEach(() => {
    archive.current = madeArchive({ rowCounts: { members: 12, payments: 40 } });
  });

  it('stores an empty problems list and reports nothing', async () => {
    const res = await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(res.ok).toBe(true);
    expect(res.problems).toEqual([]);
    expect(inserted[0]).toMatchObject({ status: 'success', problems: [] });
    expect(captured).toEqual([]);
  });

  it('marks a clean archive as the last completed backup', async () => {
    await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toHaveProperty('backup_last_run_at');
  });

  it('emails only the authenticated console link and never attaches the archive', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const res = await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: true });
    expect(res.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('attachments');
    expect(backupTemplateArgs[0]).toMatchObject({
      backupsUrl: 'https://gymflow.test/admin/settings?section=backups',
    });
  });

  it('keeps the database index when deleting an old object fails', async () => {
    prunable.success = [{ id: 'success-old', storage_path: `${GYM}/success-old.zip` }];
    removeFailure.message = 'storage unavailable';
    await runGymBackup(GYM, { trigger: 'scheduled', cadence: 'weekly', email: false });
    expect(deleted).not.toContain('success-old');
    expect(captured).toContainEqual(expect.objectContaining({ message: 'gym backup retention failed' }));
  });
});

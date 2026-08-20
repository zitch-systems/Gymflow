import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// What is actually IN a gym's backup archive (lib/backup.ts). The scheduling
// and naming rules have had a suite since this feature shipped; the archive
// itself has never had one, and it is the half that decides whether the file is
// worth anything when a gym opens it.
//
// Three properties, each of which failed silently before:
//
//   1. Identity is in it. members.csv used to be a column of UUIDs — the link
//      tables hold ids, and every name, phone and emergency contact lives in
//      profiles, which was in neither TABLES nor EXCLUDED_TABLES.
//   2. Identity is scoped through the gym's OWN links. profiles.gym_id records
//      one gym, so a member of two carries whichever was written last: reading
//      identity from it would drop this gym's members and could hand over
//      another gym's.
//   3. The row cap keeps the NEWEST rows. It was oldest-first + limit, so past
//      the cap the archive kept the oldest 50,000 and dropped the most recent
//      payments and check-ins — the rows a dispute or a restore is about.
//
// The module reads through the service-role Supabase client, so the test
// substitutes a client that speaks the same fluent shape and runs the query
// against the real gymflow_test database as the real service_role role. The
// module itself — the table list, the column lists, the ordering, the merge and
// the zip — is the shipped code.

// Tables the fake should report as unreadable, by table name.
const failing = vi.hoisted(() => new Map<string, string>());

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));

function fakeAdmin() {
  return {
    from(table: string) {
      const params: unknown[] = [];
      const conds: string[] = [];
      let columns = '*';
      let order = '';
      let limit = 0;

      // Table and column names are interpolated because every one of them comes
      // from the module's own source, never from data; matched values are bound.
      async function run() {
        const failure = failing.get(table);
        if (failure) return { data: null, error: { message: failure } };
        const sql = [
          `select ${columns} from public.${table}`,
          conds.length ? `where ${conds.join(' and ')}` : '',
          order ? `order by ${order}` : '',
          limit ? `limit ${limit}` : '',
        ].filter(Boolean).join(' ');
        try {
          const rows = await withSession({ role: 'service_role' }, async (c) => {
            const res = await c.query(sql, params);
            return res.rows;
          });
          return { data: rows, error: null };
        } catch (e) {
          // PostgREST reports failures in-band rather than by throwing.
          return { data: null, error: { message: (e as Error).message } };
        }
      }

      const q = {
        select(c: string) { columns = c; return q; },
        eq(column: string, value: unknown) { params.push(value); conds.push(`${column} = $${params.length}`); return q; },
        in(column: string, values: unknown[]) { params.push(values); conds.push(`${column} = any($${params.length}::uuid[])`); return q; },
        limit(n: number) { limit = n; return q; },
        order(column: string, opts: { ascending: boolean }) { order = `${column} ${opts.ascending ? 'asc' : 'desc'}`; return q; },
        then<T>(resolve: (v: { data: unknown; error: { message: string } | null }) => T, reject?: (e: unknown) => T) {
          return run().then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const { buildGymBackup } = await import('@/lib/backup');

// A member of Gym A whose profiles.gym_id points at Gym B — the multi-gym case
// that makes profiles.gym_id the wrong thing to scope on.
const SHARED_MEMBER = 'e1111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-08-20T09:00:00Z');

async function archiveFor(gymId: string) {
  const archive = await buildGymBackup(gymId, 'Gym A', NOW);
  const files = unzipSync(archive.bytes);
  const read = (name: string) => strFromU8(files[name] ?? new Uint8Array());
  return { archive, files, read };
}

beforeAll(async () => {
  await seed();
  await asSuperuser(async (c) => {
    await c.query(`insert into auth.users (id, email) values ($1, 'shared@example.com')`, [SHARED_MEMBER]);
    // Trains at both gyms; profiles.gym_id holds whichever was written last.
    for (const gym of [IDS.gymA, IDS.gymB]) {
      await c.query(
        `insert into public.gym_member_links (gym_id, user_id, member_id, is_active)
         values ($1, $2, $2, true)`,
        [gym, SHARED_MEMBER],
      );
    }
    await c.query(`update public.profiles set gym_id = $2 where id = $1`, [SHARED_MEMBER, IDS.gymB]);

    // The details that make a members file usable, and the signature blob that
    // must not travel in it.
    await c.query(
      `update public.profiles
          set first_name = 'Amaka', last_name = 'Obi', phone = '+2348030000001',
              emergency_contact_name = 'Chidi Obi', emergency_contact_phone = '+2348030000002',
              health_notes = 'Asthmatic — inhaler in locker 12',
              waiver_signature = $2
        where id = $1`,
      [IDS.memberA, `data:image/png;base64,${'A'.repeat(4000)}`],
    );
    await c.query(
      `update public.profiles set first_name = 'Tunde', last_name = 'Bakare', phone = '+2348030000003' where id = $1`,
      [IDS.ownerA],
    );
    // Gym B's member, whose details must never appear in Gym A's archive.
    await c.query(
      `update public.profiles set first_name = 'Ngozi', last_name = 'Eze', phone = '+2349999999999' where id = $1`,
      [IDS.memberB],
    );
  });
});

afterAll(() => { failing.clear(); });

describe('the archive carries the gym’s people, not just their ids', () => {
  it('puts each member’s details next to their link row', async () => {
    const { read } = await archiveFor(IDS.gymA);
    const members = read('members.csv');
    const header = members.split('\n')[0];
    for (const column of ['first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'emergency_contact_name', 'health_notes']) {
      expect(header, `members.csv is missing ${column}`).toContain(column);
    }
    expect(members).toContain('Amaka');
    expect(members).toContain('+2348030000001');
    expect(members).toContain('memberA@example.com');
    // The gym's own record of a member's health, in the gym's own backup.
    expect(members).toContain('Asthmatic');
  });

  it('puts each staff member’s details next to their link row', async () => {
    const { read } = await archiveFor(IDS.gymA);
    const staff = read('staff.csv');
    expect(staff).toContain('Tunde');
    expect(staff).toContain('ownerA@example.com');
    // The link's own role and is_active survive the merge — profiles has
    // columns of both names, and losing the staff role would make this file
    // useless for working out who ran the place.
    expect(staff.split('\n')[0]).toContain('role');
    expect(staff).toContain('gym_owner');
  });

  it('includes a member whose profiles.gym_id points at their OTHER gym', async () => {
    // The whole reason identity is scoped through gym_member_links. Scoping on
    // profiles.gym_id would silently drop this member from the gym they are
    // demonstrably linked to.
    const { read } = await archiveFor(IDS.gymA);
    expect(read('members.csv')).toContain('shared@example.com');
  });

  it('carries no other gym’s people, anywhere in the archive', async () => {
    const { files, read } = await archiveFor(IDS.gymA);
    for (const name of Object.keys(files)) {
      expect(read(name), `${name} leaked Gym B's member`).not.toContain('Ngozi');
      expect(read(name), `${name} leaked Gym B's member`).not.toContain('+2349999999999');
      expect(read(name), `${name} leaked Gym B's member`).not.toContain('memberB@example.com');
    }
  });

  it('leaves the signature blob out of members.csv', async () => {
    // It is kilobytes in a single spreadsheet cell, per member, and it is
    // already exported in full in waiver-signatures.csv.
    const { read } = await archiveFor(IDS.gymA);
    expect(read('members.csv')).not.toContain('data:image/png;base64');
    expect(read('members.csv').split('\n')[0]).toContain('waiver_signed_at');
  });

  it('keeps every member row even when the person has no profile details', async () => {
    // The CSV header is taken from the first row, so a row that merged nothing
    // must still carry the full set of columns or they vanish for everybody.
    const { read } = await archiveFor(IDS.gymA);
    const lines = read('members.csv').trim().split('\n');
    const columns = lines[0].split(',').length;
    for (const line of lines.slice(1)) expect(line.split(',').length).toBe(columns);
    expect(lines.length - 1).toBe(2); // memberA + the shared member
  });
});

describe('a table that cannot be read', () => {
  it('is named in failures while the rest of the archive still ships', async () => {
    failing.set('payments', 'permission denied for table payments');
    try {
      const { archive, files } = await archiveFor(IDS.gymA);
      expect(archive.failures).toEqual(['payments: permission denied for table payments']);
      expect(files['payments.csv']).toBeUndefined();
      expect(files['members.csv']).toBeDefined();
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      expect(manifest.tables.find((t: { file: string }) => t.file === 'payments.csv').error)
        .toContain('permission denied');
    } finally {
      failing.delete('payments');
    }
  });

  it('reports unreadable profiles as a failure rather than a footnote', async () => {
    // A members file with the ids but no names is not a complete backup, and
    // the run must not look clean.
    failing.set('profiles', 'permission denied for table profiles');
    try {
      const { archive, files } = await archiveFor(IDS.gymA);
      expect(archive.failures.join(' ')).toContain('member and staff details');
      expect(files['members.csv']).toBeDefined();
    } finally {
      failing.delete('profiles');
    }
  });
});

describe('the row cap', () => {
  // 50,001 rows in the one exported table with no triggers on it, so the cap is
  // exercised for real rather than asserted about from the source.
  const OLDEST = 'expense-oldest';
  const NEWEST = 'expense-newest';

  beforeAll(async () => {
    await asSuperuser(async (c) => {
      await c.query(
        `insert into public.expenses (gym_id, category, description, amount, created_at)
         select $1, 'test', 'bulk-' || i, 100, timestamptz '2020-01-01T00:00:00Z' + (i * interval '1 minute')
           from generate_series(1, 49999) i`,
        [IDS.gymA],
      );
      await c.query(
        `insert into public.expenses (gym_id, category, description, amount, created_at)
         values ($1, 'test', $2, 100, timestamptz '2019-01-01T00:00:00Z'),
                ($1, 'test', $3, 100, timestamptz '2026-01-01T00:00:00Z')`,
        [IDS.gymA, OLDEST, NEWEST],
      );
    });
  }, 60_000);

  afterAll(async () => {
    await asSuperuser(async (c) => {
      await c.query(`delete from public.expenses where gym_id = $1`, [IDS.gymA]);
    });
  });

  it('keeps the most recent rows and drops the oldest', async () => {
    const { archive, read } = await archiveFor(IDS.gymA);
    const csv = read('expenses.csv');
    expect(archive.rowCounts.expenses).toBe(50_000);
    // The newest row is the one a dispute or a restore is about. Dropping it to
    // keep a 2019 row is the wrong end of the file to cut.
    expect(csv).toContain(NEWEST);
    expect(csv).not.toContain(OLDEST);
  }, 60_000);

  it('still writes the file oldest-first', async () => {
    // Fetched descending so the cap bites at the right end, then reversed — a
    // spreadsheet that reads backwards is not what anyone opens a backup for.
    const { read } = await archiveFor(IDS.gymA);
    const lines = read('expenses.csv').trim().split('\n');
    expect(lines[lines.length - 1]).toContain(NEWEST);
    expect(lines[1]).toContain('bulk-1,'); // the oldest row that survived the cut
  }, 60_000);

  it('says so, in the manifest and as a warning', async () => {
    const { archive, files } = await archiveFor(IDS.gymA);
    expect(archive.warnings.join(' ')).toContain('expenses');
    expect(archive.warnings.join(' ')).toContain('50,000');
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.tables.find((t: { file: string }) => t.file === 'expenses.csv'))
      .toMatchObject({ truncated_at: 50_000, kept: 'most recent' });
  }, 60_000);
});

import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const REQUEST_A = 'd1111111-1111-1111-1111-111111111111';
const REQUEST_B = 'd2222222-2222-2222-2222-222222222222';
beforeAll(async () => {
  await seed();
  await asSuperuser(async (db) => {
    await db.query('delete from public.account_deletion_events');
    await db.query('delete from public.account_deletion_requests');
    await db.query(`insert into public.platform_admins (user_id, name, email, is_active) values ($1, 'Privacy operator', 'operator@example.test', true)`, [IDS.ownerA]);
    await db.query('insert into public.account_deletion_requests (id, subject_id) values ($1, $2), ($3, $4)', [REQUEST_A, IDS.memberA, REQUEST_B, IDS.memberB]);
  });
});
describe('account deletion queue policy', () => {
  it('allows only the subject to read their receipt, even after their member link is removed', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (db) => {
      const { rows } = await db.query('select id, subject_id from public.account_deletion_requests');
      expect(rows).toEqual([{ id: REQUEST_A, subject_id: IDS.memberA }]);
    });
    await asSuperuser(async (db) => { await db.query('update public.gym_member_links set is_active=false where user_id=$1', [IDS.memberA]); });
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (db) => {
      expect((await db.query('select id from public.account_deletion_requests')).rows).toEqual([{ id: REQUEST_A }]);
    });
  });
  it('does not expose completion case references through subject reads', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (db) => db.query('select completion_reference from public.account_deletion_requests'))).rejects.toMatchObject({ code: '42501' });
  });
  it('does not grant gym owners cross-account request reads', async () => {
    const result = await withSession({ role: 'authenticated', uid: IDS.ownerB }, (db) => db.query('select id from public.account_deletion_requests'));
    expect(result.rows).toEqual([]);
  });
  it.each(['select id from public.account_deletion_requests', 'select * from public.account_deletion_events'])('refuses anonymous access: %s', async (sql) => {
    await expect(withSession({ role: 'anon' }, (db) => db.query(sql))).rejects.toMatchObject({ code: '42501' });
  });
  it.each([
    `insert into public.account_deletion_requests (subject_id) values ('${IDS.ownerB}')`,
    `update public.account_deletion_requests set status='processing'`,
    'delete from public.account_deletion_requests',
  ])('refuses direct authenticated writes: %s', async (sql) => {
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (db) => db.query(sql))).rejects.toMatchObject({ code: '42501' });
  });
  it('makes duplicate service requests preserve the original receipt and deadline', async () => {
    await withSession({ role: 'service_role' }, async (db) => {
      const before = (await db.query('select * from public.account_deletion_requests where subject_id=$1', [IDS.memberA])).rows[0];
      await db.query('insert into public.account_deletion_requests (subject_id) values ($1) on conflict (subject_id) do nothing', [IDS.memberA]);
      const after = (await db.query('select * from public.account_deletion_requests where subject_id=$1', [IDS.memberA])).rows[0];
      expect(after).toEqual(before);
    });
  });
  it('keeps the durable request when the Auth identity is deleted', async () => {
    await asSuperuser(async (db) => {
      await db.query('begin');
      try {
        // seed() includes real payment/waiver fixtures, whose RESTRICT guards
        // correctly prevent cascading deletion. Use a new empty identity.
        const subject = 'b3333333-3333-3333-3333-333333333333';
        await db.query('insert into auth.users (id, email) values ($1, $2)', [subject, 'empty-deletion-fixture@example.test']);
        const created = (await db.query('insert into public.account_deletion_requests (subject_id) values ($1) returning id', [subject])).rows[0];
        await db.query('delete from auth.users where id=$1', [subject]);
        expect((await db.query('select id from public.account_deletion_requests where subject_id=$1', [subject])).rows).toEqual([{ id: created.id }]);
      } finally { await db.query('rollback'); }
    });
  });
  it('does not allow completed status without non-null completion evidence', async () => {
    await expect(withSession({ role: 'service_role' }, (db) => db.query(`update public.account_deletion_requests set status='completed', completed_at=now(), processed_by=$1, confirmation_sent_at=now() where id=$2`, [IDS.ownerA, REQUEST_A]))).rejects.toMatchObject({ code: '23514' });
  });
});

const advance = (db: { query: (sql: string, values: unknown[]) => Promise<{ rows: Array<{ changed: boolean }> }> }, actor: string, expected = 'pending', status = 'processing', evidence = false) => db.query(
  'select public.review_account_deletion_request($1,$2,$3,$4,$5,$5,$6,$7) as changed',
  [REQUEST_A, actor, expected, status, evidence, evidence ? 'case-reference-123' : null, evidence ? 'No personal records retained.' : null],
);
describe('account deletion operator workflow', () => {
  it.each([
    { uid: IDS.memberA }, { uid: IDS.ownerB }, { uid: IDS.ownerA, verified: false },
    { uid: IDS.ownerA, authSessionExpired: true }, { uid: IDS.ownerA, accountBanned: true },
  ])('requires a live verified active platform-admin identity: %o', async (context) => {
    await expect(withSession({ role: 'authenticated', ...context }, (db) => advance(db, context.uid))).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects forged actor identifiers from a valid administrator', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.ownerA }, (db) => advance(db, IDS.ownerB))).rejects.toMatchObject({ code: '42501' });
  });
  it('blocks anonymous callers at the execute grant', async () => {
    await expect(withSession({ role: 'anon' }, (db) => advance(db, IDS.ownerA))).rejects.toMatchObject({ code: '42501' });
  });
  it('cannot mark pending work completed in one click', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.ownerA }, (db) => advance(db, IDS.ownerA, 'pending', 'completed', true))).rejects.toMatchObject({ code: '22023' });
  });
  it('requires erasure and confirmation evidence at completion', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.ownerA }, async (db) => {
      await advance(db, IDS.ownerA);
      await advance(db, IDS.ownerA, 'processing', 'completed');
    })).rejects.toMatchObject({ code: '22023' });
  });
  it('advances and audits atomically while refusing stale duplicate actions', async () => {
    await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (db) => {
      expect((await advance(db, IDS.ownerA)).rows[0].changed).toBe(true);
      expect((await advance(db, IDS.ownerA)).rows[0].changed).toBe(false);
      expect((await advance(db, IDS.ownerA, 'processing', 'completed', true)).rows[0].changed).toBe(true);
      await db.query('reset role');
      const receipt = (await db.query('select status, completed_at, confirmation_sent_at from public.account_deletion_requests where id=$1', [REQUEST_A])).rows[0];
      expect(receipt.status).toBe('completed');
      expect(receipt.completed_at).not.toBeNull();
      expect(receipt.confirmation_sent_at).not.toBeNull();
      expect((await db.query('select new_status from public.account_deletion_events where request_id=$1 order by id', [REQUEST_A])).rows).toEqual([{ new_status: 'processing' }, { new_status: 'completed' }]);
    });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { withSession } from './db';
import { IDS, seed } from './seed';

const CARD_A = 'ca111111-1111-4111-8111-111111111111';
const CARD_B = 'ca222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  await seed();
  await withSession({ role: 'service_role', commit: true }, async (db) => {
    await db.query(
      `insert into public.saved_cards
         (id, gym_id, member_id, authorization_code, paystack_authorization_code,
          brand, last4, exp_month, exp_year, is_default, is_active)
       values ($1, $2, $3, 'AUTH_fixture_a', 'AUTH_legacy_a', 'visa', '1234', '12', '2030', true, true),
              ($4, $5, $6, 'AUTH_fixture_b', 'AUTH_legacy_b', 'mastercard', '5678', '11', '2031', false, true)`,
      [CARD_A, IDS.gymA, IDS.memberA, CARD_B, IDS.gymB, IDS.memberB],
    );
  });
});

describe('saved card credentials and tenant access', () => {
  it('keeps the explicit web and native wallet display query working for its owner', async () => {
    const result = await withSession({ role: 'authenticated', uid: IDS.memberA }, (db) => db.query(
      `select id, brand, last4, exp_month, exp_year, bank, is_default
       from public.saved_cards
       where member_id=$1 and gym_id=$2 and is_active=true
       order by is_default desc`,
      [IDS.memberA, IDS.gymA],
    ));
    expect(result.rows).toEqual([{
      id: CARD_A, brand: 'visa', last4: '1234', exp_month: '12', exp_year: '2030',
      bank: null, is_default: true,
    }]);
  });

  it('applies ownership even when the caller omits the member and gym filters', async () => {
    const result = await withSession({ role: 'authenticated', uid: IDS.memberA }, (db) =>
      db.query('select id from public.saved_cards'));
    expect(result.rows).toEqual([{ id: CARD_A }]);
  });

  it.each([IDS.ownerA, IDS.ownerB])('does not expose member cards to gym staff: %s', async (uid) => {
    const result = await withSession({ role: 'authenticated', uid }, (db) =>
      db.query('select id from public.saved_cards'));
    expect(result.rows).toEqual([]);
  });

  it.each([
    'select authorization_code from public.saved_cards',
    'select paystack_authorization_code from public.saved_cards',
    'select * from public.saved_cards',
    "select id from public.saved_cards where authorization_code='AUTH_fixture_a'",
  ])('denies token disclosure, including predicates and wildcard selects: %s', async (sql) => {
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (db) =>
      db.query(sql))).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    `insert into public.saved_cards (gym_id, member_id, authorization_code) values ('${IDS.gymA}', '${IDS.memberA}', 'AUTH_forged')`,
    `update public.saved_cards set authorization_code='AUTH_forged' where id='${CARD_A}'`,
    `update public.saved_cards set is_default=false where id='${CARD_A}'`,
    `delete from public.saved_cards where id='${CARD_A}'`,
    'truncate public.saved_cards',
  ])('rejects direct member writes to provider-managed state: %s', async (sql) => {
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (db) =>
      db.query(sql))).rejects.toMatchObject({ code: '42501' });
  });

  it('denies even display fields to anonymous callers', async () => {
    await expect(withSession({ role: 'anon' }, (db) =>
      db.query('select id, last4 from public.saved_cards'))).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves verified server processing and deletion of provider state', async () => {
    await withSession({ role: 'service_role' }, async (db) => {
      const original = await db.query(
        'select authorization_code, paystack_authorization_code from public.saved_cards where id=$1', [CARD_A],
      );
      expect(original.rows[0]).toEqual({
        authorization_code: 'AUTH_fixture_a', paystack_authorization_code: 'AUTH_legacy_a',
      });
      expect((await db.query(
        'update public.saved_cards set is_active=false where id=$1', [CARD_A],
      )).rowCount).toBe(1);
      expect((await db.query('delete from public.saved_cards where id=$1', [CARD_A])).rowCount).toBe(1);
    });
  });
});

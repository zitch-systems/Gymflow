import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const WAIVER = 'f1111111-1111-4111-8111-111111111111';
beforeEach(async () => {
  await seed();
  await asSuperuser((c) => c.query('insert into public.waivers (id,gym_id,title,content) values ($1,$2,$3,$4)', [WAIVER, IDS.gymA, 'Gym waiver', 'Text']));
});
describe('waiver revision history under member authorization', () => {
  const insert = (gym: string, revision: string) => withSession({ role: 'authenticated', uid: IDS.memberA, commit: true }, (c) => c.query(
    'insert into public.waiver_signatures (gym_id,waiver_id,member_id,signature,signature_data) values ($1,$2,$3,$4,$5)',
    [gym, WAIVER, IDS.memberA, revision, JSON.stringify({ revision })],
  ));
  it('preserves multiple reviewed revisions while rejecting duplicate acceptance', async () => {
    await insert(IDS.gymA, 'revision-1');
    await insert(IDS.gymA, 'revision-2');
    await expect(insert(IDS.gymA, 'revision-2')).rejects.toMatchObject({ code: '23505' });
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      const { rows } = await c.query('select signature from public.waiver_signatures where waiver_id=$1 order by signature', [WAIVER]);
      expect(rows.map((r) => r.signature)).toEqual(['revision-1', 'revision-2']);
    });
  });
  it('continues rejecting cross-gym signatures', async () => {
    await expect(insert(IDS.gymB, 'revision-1')).rejects.toThrow(/gym|security|permission/i);
  });
});

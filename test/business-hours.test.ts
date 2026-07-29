import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser } from './db';
import { IDS, seed } from './seed';

// Split-session opening hours (20260729_business_hours_split_sessions).
//
// The shipped UI offered "Split sessions" against a table that could only hold
// one row per day, so saving a morning + evening day always failed on
// business_hours_gym_id_day_of_week_key — and, because the save deleted before
// it inserted, it took the gym's existing hours with it. Both halves are
// pinned here.

beforeAll(async () => { await seed(); });

const MORNING = { day: 1, open: '05:00', close: '12:00', session: 'morning' };
const EVENING = { day: 1, open: '17:00', close: '21:00', session: 'evening' };

async function hoursFor(gymId: string) {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ day_of_week: number; session: string }>(
      `select day_of_week, session from public.business_hours where gym_id = $1 order by day_of_week, session`,
      [gymId],
    );
    return rows;
  });
}

async function clear(gymId: string) {
  await asSuperuser((c) => c.query(`delete from public.business_hours where gym_id = $1`, [gymId]));
}

describe('split sessions', () => {
  it('accepts several sessions on the same day', async () => {
    await clear(IDS.gymA);
    await asSuperuser(async (c) => {
      for (const s of [MORNING, EVENING]) {
        await c.query(
          `insert into public.business_hours (gym_id, day_of_week, open_time, close_time, is_closed, session)
           values ($1, $2, $3, $4, false, $5)`,
          [IDS.gymA, s.day, s.open, s.close, s.session],
        );
      }
    });
    expect(await hoursFor(IDS.gymA)).toEqual([
      { day_of_week: 1, session: 'evening' },
      { day_of_week: 1, session: 'morning' },
    ]);
  });

  it('still rejects the same session twice on one day', async () => {
    await clear(IDS.gymA);
    await asSuperuser(async (c) => {
      const insert = () => c.query(
        `insert into public.business_hours (gym_id, day_of_week, open_time, close_time, is_closed, session)
         values ($1, 1, '05:00', '12:00', false, 'morning')`,
        [IDS.gymA],
      );
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('replace_business_hours', () => {
  it('swaps the whole week in one call', async () => {
    await clear(IDS.gymA);
    await asSuperuser((c) => c.query(`select public.replace_business_hours($1, $2::jsonb)`, [
      IDS.gymA,
      JSON.stringify([
        { day_of_week: 1, open_time: '05:00', close_time: '12:00', is_closed: false, session: 'morning' },
        { day_of_week: 1, open_time: '17:00', close_time: '21:00', is_closed: false, session: 'evening' },
        { day_of_week: 0, open_time: null, close_time: null, is_closed: true, session: 'all' },
      ]),
    ]));

    expect(await hoursFor(IDS.gymA)).toEqual([
      { day_of_week: 0, session: 'all' },
      { day_of_week: 1, session: 'evening' },
      { day_of_week: 1, session: 'morning' },
    ]);
  });

  it('keeps the old hours when the new set is rejected', async () => {
    // The bug that lost a gym's hours: delete committed, insert failed. One
    // function body means one transaction, so a bad row takes the delete with
    // it. day_of_week 9 trips business_hours_day_of_week_check.
    await clear(IDS.gymA);
    await asSuperuser((c) => c.query(`select public.replace_business_hours($1, $2::jsonb)`, [
      IDS.gymA,
      JSON.stringify([{ day_of_week: 2, open_time: '06:00', close_time: '20:00', is_closed: false, session: 'all' }]),
    ]));

    await asSuperuser(async (c) => {
      await expect(c.query(`select public.replace_business_hours($1, $2::jsonb)`, [
        IDS.gymA,
        JSON.stringify([{ day_of_week: 9, open_time: '06:00', close_time: '20:00', is_closed: false, session: 'all' }]),
      ])).rejects.toMatchObject({ code: '23514' });
    });

    expect(await hoursFor(IDS.gymA)).toEqual([{ day_of_week: 2, session: 'all' }]);
  });

  it('files every row under the gym passed in, not one named in the payload', async () => {
    await clear(IDS.gymA);
    await clear(IDS.gymB);
    await asSuperuser((c) => c.query(`select public.replace_business_hours($1, $2::jsonb)`, [
      IDS.gymA,
      // A crafted payload naming another gym must not place rows there.
      JSON.stringify([{ gym_id: IDS.gymB, day_of_week: 3, open_time: '06:00', close_time: '20:00', is_closed: false, session: 'all' }]),
    ]));

    expect(await hoursFor(IDS.gymA)).toEqual([{ day_of_week: 3, session: 'all' }]);
    expect(await hoursFor(IDS.gymB)).toEqual([]);
    await clear(IDS.gymA);
  });
});

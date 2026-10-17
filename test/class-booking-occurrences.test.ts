import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const CLASS = 'd1111111-1111-4111-8111-111111111111';
const SLOT = 'e1111111-1111-4111-8111-111111111111';
let occurrence: string;
let following: string;

beforeEach(async () => {
  await seed();
  await asSuperuser(async (c) => {
    const { rows } = await c.query(`select ((now() at time zone 'Africa/Lagos')::date + 7)::text as date,
      ((now() at time zone 'Africa/Lagos')::date + 14)::text as following,
      extract(dow from (now() at time zone 'Africa/Lagos'))::integer as dow`);
    occurrence = rows[0].date; following = rows[0].following;
    await c.query(`insert into public.classes(id,gym_id,name,max_capacity) values ($1,$2,'One seat',1)`, [CLASS, IDS.gymA]);
    await c.query(`insert into public.class_schedules(id,gym_id,class_id,day_of_week,start_time,end_time)
      values ($1,$2,$3,$4,'09:00','10:00')`, [SLOT, IDS.gymA, CLASS, rows[0].dow]);
    await c.query(`insert into public.gym_member_links(gym_id,user_id,member_id,is_active)
      values ($1,$2,$2,true)`, [IDS.gymA, IDS.memberB]);
  });
});

function book(member: string, date = occurrence, commit = false) {
  return withSession({ role: 'authenticated', uid: member, commit }, async (c) => {
    const { rows } = await c.query(`insert into public.class_bookings(gym_id,class_schedule_id,class_id,member_id,booking_date,status)
      values ($1,$2,$3,$4,$5,'booked') returning id,status`, [IDS.gymA, SLOT, CLASS, member, date]);
    return rows[0] as { id: string; status: string };
  });
}

describe('class occurrence persistence and actual member RLS', () => {
  it('allows a member to cancel and book again without rewriting the cancelled record', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      const insert = `insert into public.class_bookings(gym_id,class_schedule_id,class_id,member_id,booking_date,status)
        values ($1,$2,$3,$4,$5,'booked') returning id,status`;
      const args = [IDS.gymA, SLOT, CLASS, IDS.memberA, occurrence];
      const { rows: first } = await c.query(insert, args);
      await c.query(`update public.class_bookings set status='cancelled' where id=$1`, [first[0].id]);
      const { rows: second } = await c.query(insert, args);
      expect(second[0].id).not.toBe(first[0].id);
      const { rows } = await c.query(`select status from public.class_bookings where member_id=$1 order by status`, [IDS.memberA]);
      expect(rows.map((r) => r.status)).toEqual(['booked', 'cancelled']);
    });
  });

  it('allows bookings on distinct dates but refuses duplicate active seats on one date', async () => {
    await book(IDS.memberA, occurrence, true);
    expect((await book(IDS.memberA, following)).status).toBe('booked');
    await expect(book(IDS.memberA, occurrence)).rejects.toMatchObject({ code: '23505' });
  });

  it('counts another member’s seat despite member-only read policies', async () => {
    await book(IDS.memberA, occurrence, true);
    const result = await book(IDS.memberB);
    expect(result.status).toBe('waitlisted');
  });

  it('serializes concurrent contenders for the final seat', async () => {
    const results = await Promise.all([book(IDS.memberA, occurrence, true), book(IDS.memberB, occurrence, true)]);
    expect(results.map((r) => r.status).sort()).toEqual(['booked', 'waitlisted']);
  });

  it('keeps cross-gym booking writes blocked', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (c) => c.query(
      `insert into public.class_bookings(gym_id,class_schedule_id,class_id,member_id,booking_date,status)
       values ($1,$2,$3,$4,$5,'booked')`, [IDS.gymB, SLOT, CLASS, IDS.memberA, occurrence],
    ))).rejects.toThrow(/schedule|security|permission/i);
  });
});

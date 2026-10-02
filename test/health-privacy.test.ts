import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const STAFF = {
  manager: 'd1111111-1111-4111-8111-111111111111',
  frontDesk: 'd2222222-2222-4222-8222-222222222222',
  accountant: 'd3333333-3333-4333-8333-333333333333',
  instructor: 'd4444444-4444-4444-8444-444444444444',
} as const;

beforeEach(async () => {
  await seed();
  await asSuperuser(async (c) => {
    for (const [role, id] of Object.entries(STAFF)) {
      await c.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.com`]);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, $3, true)`,
        [IDS.gymA, id, role === 'frontDesk' ? 'front_desk' : role],
      );
    }
    await c.query(
      `insert into public.profile_health_notes
         (member_id, notes, update_source)
       values ($1, 'Asthma — inhaler in locker', 'migration')`,
      [IDS.memberA],
    );
  });
});

async function visibleNotes(uid: string, verified = true): Promise<string[]> {
  return withSession({ role: 'authenticated', uid, verified }, async (c) => {
    const { rows } = await c.query<{ notes: string }>(
      `select notes from public.profile_health_notes order by member_id`,
    );
    return rows.map((r) => r.notes);
  });
}

describe('protected health-note reads', () => {
  it('lets the member read their own profile-level note', async () => {
    expect(await visibleNotes(IDS.memberA)).toEqual(['Asthma — inhaler in locker']);
  });

  it('lets a verified owner or manager read an actively linked member', async () => {
    expect(await visibleNotes(IDS.ownerA)).toHaveLength(1);
    expect(await visibleNotes(STAFF.manager)).toHaveLength(1);
  });

  it('denies another tenant and a password-only owner session', async () => {
    expect(await visibleNotes(IDS.ownerB)).toEqual([]);
    expect(await visibleNotes(IDS.ownerA, false)).toEqual([]);
  });

  it.each([
    ['front desk', STAFF.frontDesk],
    ['accountant', STAFF.accountant],
    ['unassigned instructor', STAFF.instructor],
  ])('denies %s staff', async (_label, uid) => {
    expect(await visibleNotes(uid)).toEqual([]);
  });

  it('allows only an explicitly active assigned instructor', async () => {
    await asSuperuser((c) => c.query(
      `insert into public.instructor_subscriptions
         (gym_id, instructor_id, member_id, plan_id, status, end_date)
       values ($1, $2, $3, $4, 'active', current_date + 30)`,
      [IDS.gymA, STAFF.instructor, IDS.memberA, IDS.planA],
    ));
    expect(await visibleNotes(STAFF.instructor)).toEqual(['Asthma — inhaler in locker']);
  });
});

describe('controlled health-note mutation', () => {
  it('lets a member set and clear their own note and records metadata', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await c.query(`select public.set_profile_health_note($1, $2, $3, $4)`, [
        IDS.gymA, IDS.memberA, 'Knee injury', 'member correction',
      ]);
      const set = await c.query(`select notes, updated_by from public.profile_health_notes where member_id = $1`, [IDS.memberA]);
      expect(set.rows[0]).toMatchObject({ notes: 'Knee injury', updated_by: IDS.memberA });
      await c.query(`select public.set_profile_health_note($1, $2, null, $3)`, [
        IDS.gymA, IDS.memberA, 'condition resolved',
      ]);
      const cleared = await c.query(`select notes from public.profile_health_notes where member_id = $1`, [IDS.memberA]);
      expect(cleared.rows[0].notes).toBeNull();
      const audit = await c.query(`select action, reason from public.profile_health_note_audit order by id`);
      expect(audit.rows).toEqual([
        { action: 'set', reason: 'member correction' },
        { action: 'clear', reason: 'condition resolved' },
      ]);
    });
  });

  it('keeps raw note text out of the audit schema', async () => {
    const columns = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'profile_health_note_audit'`,
      );
      return rows.map((r) => r.column_name);
    });
    expect(columns).not.toContain('notes');
    expect(columns).not.toContain('old_notes');
  });

  it('rejects unrelated roles and cross-tenant managers', async () => {
    for (const uid of [STAFF.frontDesk, STAFF.accountant, STAFF.instructor, IDS.ownerB]) {
      await expect(withSession({ role: 'authenticated', uid }, (c) =>
        c.query(`select public.set_profile_health_note($1, $2, $3, null)`, [IDS.gymA, IDS.memberA, 'Nope']),
      )).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('adapts an authorised legacy non-null write but keeps profiles null', async () => {
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await c.query(`update public.profiles set health_notes = 'Legacy allergy' where id = $1`, [IDS.memberA]);
      const legacy = await c.query(`select health_notes from public.profiles where id = $1`, [IDS.memberA]);
      const protectedRow = await c.query(`select notes, update_source from public.profile_health_notes where member_id = $1`, [IDS.memberA]);
      expect(legacy.rows[0].health_notes).toBeNull();
      expect(protectedRow.rows[0]).toEqual({ notes: 'Legacy allergy', update_source: 'legacy_adapter' });
    });
  });
});

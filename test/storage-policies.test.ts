import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const STAFF = {
  manager: 'e1111111-1111-4111-8111-111111111111',
  instructor: 'e2222222-2222-4222-8222-222222222222',
  frontDesk: 'e3333333-3333-4333-8333-333333333333',
  accountant: 'e4444444-4444-4444-8444-444444444444',
} as const;

beforeEach(async () => {
  await seed();
  await asSuperuser(async (c) => {
    await c.query(
      `delete from storage.objects
       where name like $1 or name like $2`,
      [`${IDS.gymA}/%`, `${IDS.gymB}/%`],
    );
    for (const [role, id] of Object.entries(STAFF)) {
      await c.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@storage.example`]);
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, $3, true)`,
        [IDS.gymA, id, role === 'frontDesk' ? 'front_desk' : role],
      );
    }
    await c.query(
      `insert into storage.objects (bucket_id, name) values
       ('gym-assets', $1), ('gym-assets', $2),
       ('gym-backups', $3), ('gym-backups', $4)`,
      [
        `${IDS.gymA}/gallery/a.png`, `${IDS.gymB}/gallery/b.png`,
        `${IDS.gymA}/backup-a.zip`, `${IDS.gymB}/backup-b.zip`,
      ],
    );
  });
});

async function names(uid: string, bucket: string, verified = true): Promise<string[]> {
  return withSession({ role: 'authenticated', uid, verified }, async (c) => {
    const { rows } = await c.query<{ name: string }>(
      `select name from storage.objects where bucket_id = $1 order by name`, [bucket],
    );
    return rows.map((r) => r.name);
  });
}

describe('gym-assets tenant prefix policies', () => {
  it('lets verified owners/managers see only their gym prefix', async () => {
    expect(await names(IDS.ownerA, 'gym-assets')).toEqual([`${IDS.gymA}/gallery/a.png`]);
    expect(await names(IDS.ownerB, 'gym-assets')).toEqual([`${IDS.gymB}/gallery/b.png`]);
    expect(await names(STAFF.manager, 'gym-assets')).toEqual([`${IDS.gymA}/gallery/a.png`]);
    expect(await names(IDS.ownerA, 'gym-assets', false)).toEqual([]);
  });

  it('denies ordinary members, front desk and accountants', async () => {
    for (const uid of [IDS.memberA, STAFF.frontDesk, STAFF.accountant]) {
      expect(await names(uid, 'gym-assets')).toEqual([]);
    }
  });

  it('blocks cross-tenant insert, path moves and delete', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.ownerA }, (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('gym-assets', $1)`,
      [`${IDS.gymB}/gallery/cross-tenant.png`],
    ))).rejects.toMatchObject({ code: '42501' });

    await expect(withSession({ role: 'authenticated', uid: IDS.ownerA }, (c) => c.query(
      `update storage.objects set name = $1
       where bucket_id = 'gym-assets' and name = $2`,
      [`${IDS.gymB}/gallery/moved.png`, `${IDS.gymA}/gallery/a.png`],
    ))).rejects.toMatchObject({ code: '42501' });

    const deleted = await withSession({ role: 'authenticated', uid: IDS.ownerA }, (c) => c.query(
      `delete from storage.objects
       where bucket_id = 'gym-assets' and name = $1`,
      [`${IDS.gymB}/gallery/b.png`],
    ));
    expect(deleted.rowCount).toBe(0);
  });

  it('limits instructors to their own avatar object', async () => {
    await withSession({ role: 'authenticated', uid: STAFF.instructor, commit: true }, (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('gym-assets', $1)`,
      [`${IDS.gymA}/avatars/${STAFF.instructor}-1.png`],
    ));
    expect(await names(STAFF.instructor, 'gym-assets')).toEqual([
      `${IDS.gymA}/avatars/${STAFF.instructor}-1.png`,
    ]);
    await expect(withSession({ role: 'authenticated', uid: STAFF.instructor }, (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('gym-assets', $1)`,
      [`${IDS.gymA}/gallery/instructor.png`],
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(withSession({ role: 'authenticated', uid: STAFF.instructor }, (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('gym-assets', $1)`,
      [`${IDS.gymB}/avatars/${STAFF.instructor}-2.png`],
    ))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('private backup objects', () => {
  it('allows verified owner/manager reads only for their gym', async () => {
    expect(await names(IDS.ownerA, 'gym-backups')).toEqual([`${IDS.gymA}/backup-a.zip`]);
    expect(await names(STAFF.manager, 'gym-backups')).toEqual([`${IDS.gymA}/backup-a.zip`]);
    expect(await names(IDS.ownerB, 'gym-backups')).toEqual([`${IDS.gymB}/backup-b.zip`]);
  });

  it('denies member, public-facing staff and password-only sessions', async () => {
    for (const uid of [IDS.memberA, STAFF.frontDesk, STAFF.accountant, STAFF.instructor]) {
      expect(await names(uid, 'gym-backups')).toEqual([]);
    }
    expect(await names(IDS.ownerA, 'gym-backups', false)).toEqual([]);
  });

  it('has no authenticated backup upload path', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.ownerA }, (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('gym-backups', $1)`,
      [`${IDS.gymA}/forged.zip`],
    ))).rejects.toMatchObject({ code: '42501' });
  });
});

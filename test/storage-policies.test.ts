import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const STAFF = {
  manager: 'e1111111-1111-4111-8111-111111111111',
  instructor: 'e2222222-2222-4222-8222-222222222222',
  frontDesk: 'e3333333-3333-4333-8333-333333333333',
  accountant: 'e4444444-4444-4444-8444-444444444444',
} as const;

const LEGACY_POLICIES = [
  'test_legacy_storage_select_all',
  'test_legacy_storage_insert_all',
  'test_legacy_storage_update_all',
  'test_legacy_storage_delete_all',
  'test_legacy_raw_staff_select',
  'test_legacy_raw_staff_update',
] as const;

beforeAll(async () => {
  await asSuperuser(async (c) => {
    // Model the live risk: old dashboard policies plus public table grants.
    // The four broad policies remain intentionally permissive so every denial
    // in this file depends on the forward migration's restrictive guards.
    await c.query(`grant select,insert,update,delete on storage.objects to anon`);
    await c.query(`create role legacy_storage_policy_test nologin`);
    await c.query(`create policy test_legacy_storage_select_all on storage.objects
      for select to anon,authenticated using (true)`);
    await c.query(`create policy test_legacy_storage_insert_all on storage.objects
      for insert to anon,authenticated with check (true)`);
    await c.query(`create policy test_legacy_storage_update_all on storage.objects
      for update to anon,authenticated using (true) with check (true)`);
    await c.query(`create policy test_legacy_storage_delete_all on storage.objects
      for delete to anon,authenticated using (true)`);
    await c.query(`create policy test_legacy_raw_staff_select on storage.objects
      for select to legacy_storage_policy_test using (exists (
        select 1 from public.gym_staff_links s where s.user_id=auth.uid()
      ))`);
    await c.query(`create policy test_legacy_raw_staff_update on storage.objects
      for update to legacy_storage_policy_test
      using (exists (select 1 from public.gym_staff_links s where s.user_id=auth.uid()))
      with check (exists (select 1 from public.platform_admins p where p.user_id=auth.uid()))`);
    expect((await c.query(`select private.harden_legacy_storage_policies() changed`)).rows[0].changed).toBe(2);
  });
});

afterAll(async () => {
  await asSuperuser(async (c) => {
    for (const policy of LEGACY_POLICIES) {
      await c.query(`drop policy ${policy} on storage.objects`);
    }
    await c.query(`revoke select,insert,update,delete on storage.objects from anon`);
    await c.query(`drop role legacy_storage_policy_test`);
  });
});

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

async function anonNames(bucket: string): Promise<string[]> {
  return withSession({ role: 'anon' }, async (c) => {
    const { rows } = await c.query<{ name: string }>(
      `select name from storage.objects where bucket_id=$1 order by name`, [bucket],
    );
    return rows.map((r) => r.name);
  });
}

describe('restrictive legacy-policy containment', () => {
  it('installs four restrictive guards for anon and authenticated', async () => {
    const policies = await asSuperuser((c) => c.query(
      `select polname,polpermissive,
         (select array_agg(r.rolname::text order by r.rolname)::text[]
          from unnest(polroles) as role_ids(oid) join pg_roles r on r.oid=role_ids.oid) roles
       from pg_policy where polrelid='storage.objects'::regclass
         and polname like 'gym_storage_guard_%' order by polname`,
    ));
    expect(policies.rows).toEqual([
      { polname: 'gym_storage_guard_delete', polpermissive: false, roles: ['anon', 'authenticated'] },
      { polname: 'gym_storage_guard_insert', polpermissive: false, roles: ['anon', 'authenticated'] },
      { polname: 'gym_storage_guard_select', polpermissive: false, roles: ['anon', 'authenticated'] },
      { polname: 'gym_storage_guard_update', polpermissive: false, roles: ['anon', 'authenticated'] },
    ]);
  });

  it('adds a protected-bucket proof gate to exact raw legacy staff predicates', async () => {
    const policies = await asSuperuser((c) => c.query(
      `select polname,pg_get_expr(polqual,polrelid) qualify,
         pg_get_expr(polwithcheck,polrelid) check_expr
       from pg_policy where polrelid='storage.objects'::regclass
         and polname in ('test_legacy_raw_staff_select','test_legacy_raw_staff_update')
       order by polname`,
    ));
    expect(policies.rows).toHaveLength(2);
    for (const row of policies.rows) {
      expect(row.qualify).toContain('gym_staff_links');
      expect(row.qualify).toContain('privileged_session_verified');
      expect(row.qualify).toContain('gym-backups');
    }
    expect(policies.rows[1].check_expr).toContain('platform_admins');
    expect(policies.rows[1].check_expr).toContain('privileged_session_verified');
    expect(policies.rows[1].check_expr).toContain('gym-assets');
  });

  it('defeats broad public/authenticated policies on both protected buckets', async () => {
    expect(await anonNames('gym-assets')).toEqual([]);
    expect(await anonNames('gym-backups')).toEqual([]);
    expect(await names(IDS.ownerA, 'gym-assets', false)).toEqual([]);
    expect(await names(IDS.memberA, 'gym-assets')).toEqual([]);
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (c) => c.query(
      `insert into storage.objects(bucket_id,name) values('gym-assets',$1)`,
      [`${IDS.gymA}/gallery/permissive-bypass.png`],
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(withSession({ role: 'anon' }, (c) => c.query(
      `insert into storage.objects(bucket_id,name) values('gym-backups',$1)`,
      [`${IDS.gymA}/public-forged.zip`],
    ))).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves broad legacy behavior for unrelated buckets and service bypass', async () => {
    await withSession({ role: 'anon', commit: true }, (c) =>
      c.query(`insert into storage.objects(bucket_id,name) values('public-legacy','anonymous.txt')`),
    );
    expect(await anonNames('public-legacy')).toEqual(['anonymous.txt']);
    await withSession({ role: 'anon', commit: true }, (c) =>
      c.query(`delete from storage.objects where bucket_id='public-legacy'`),
    );
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      await c.query(`insert into storage.objects(bucket_id,name) values('unrelated','member.txt')`);
      expect((await c.query(`select name from storage.objects where bucket_id='unrelated'`)).rows)
        .toEqual([{ name: 'member.txt' }]);
      expect((await c.query(`update storage.objects set name='renamed.txt' where bucket_id='unrelated'`)).rowCount).toBe(1);
      expect((await c.query(`delete from storage.objects where bucket_id='unrelated'`)).rowCount).toBe(1);
    });
    await withSession({ role: 'service_role' }, async (c) => {
      await c.query(`insert into storage.objects(bucket_id,name) values('gym-backups',$1)`, [`${IDS.gymA}/service.zip`]);
      expect((await c.query(`select name from storage.objects where name=$1`, [`${IDS.gymA}/service.zip`])).rowCount).toBe(1);
    });
  });
});

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

import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, fixtureSessionId, withSession } from './db';
import { IDS, seed } from './seed';
import { hashCode } from '@/lib/two-factor';

beforeAll(async () => { await seed(); });

async function verified(uid: string, options: { verified?: boolean; sessionId?: string; authSessionExpired?: boolean } = {}) {
  return withSession({ role: 'authenticated', uid, ...options }, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>(`select public.privileged_session_verified() as ok`);
    return rows[0].ok;
  });
}

describe('exact-session privileged proof', () => {
  it('denies a password-only owner JWT while preserving own role-link discovery and member access', async () => {
    const owner = await withSession({ role: 'authenticated', uid: IDS.ownerA, verified: false }, async (c) => {
      const proof = await c.query<{ ok: boolean }>(`select public.privileged_session_verified() ok`);
      const links = await c.query(`select gym_id from public.gym_staff_links where user_id=$1`, [IDS.ownerA]);
      const payments = await c.query(`select id from public.payments`);
      await expect(c.query(
        `insert into public.notifications (gym_id,user_id,title,body) values ($1,$2,'staff','blocked')`,
        [IDS.gymA, IDS.memberA],
      )).rejects.toThrow(/row-level security/i);
      return { proof: proof.rows[0].ok, links: links.rowCount, payments: payments.rowCount };
    });
    expect(owner).toEqual({ proof: false, links: 1, payments: 0 });

    const memberPayments = await withSession(
      { role: 'authenticated', uid: IDS.memberA, verified: false },
      async (c) => (await c.query(`select id from public.payments`)).rowCount,
    );
    expect(memberPayments).toBe(1);
  });

  it('denies password-only access through privileged SECURITY DEFINER RPCs', async () => {
    await withSession({ role: 'authenticated', uid: IDS.ownerA, verified: false }, async (c) => {
      await expect(c.query(
        `select public.gym_member_roster($1,null,'all',0,1)`, [IDS.gymA],
      )).rejects.toThrow(/restricted to verified gym staff/i);
    });
    await withSession({ role: 'authenticated', uid: IDS.ownerA, verified: false }, async (c) => {
      await expect(c.query(
        `select public.record_staff_payment($1,$2,$3,'proof-bypass',1000,'cash',$4,false,'security test')`,
        ['84444444-2222-4333-8444-555555555555', IDS.gymA, IDS.memberA, IDS.planA],
      )).rejects.toThrow(/verified gym staff required/i);
    });
  });

  it('allows the same owner session after a successful proof', async () => {
    const result = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const proof = await c.query<{ ok: boolean }>(`select public.privileged_session_verified() ok`);
      const payments = await c.query(`select id from public.payments`);
      const inserted = await c.query(
        `insert into public.notifications (gym_id,user_id,title,body) values ($1,$2,'staff','allowed') returning id`,
        [IDS.gymA, IDS.memberA],
      );
      return { proof: proof.rows[0].ok, payments: payments.rowCount, inserted: inserted.rowCount };
    });
    expect(result).toEqual({ proof: true, payments: 1, inserted: 1 });
  });

  it('cannot disable mandatory staff verification through the legacy gym column', async () => {
    await expect(withSession({ role: 'authenticated', uid: IDS.ownerA }, (c) => c.query(
      `update public.gyms set two_factor_required=false where id=$1`,
      [IDS.gymA],
    ))).rejects.toThrow(/gyms_two_factor_mandatory|check constraint/i);
  });

  it('rejects proof replay by another session or another user', async () => {
    const result = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const otherSession = fixtureSessionId(IDS.ownerA, 'other');
      await c.query(`select set_config('request.jwt.claims',$1,true)`, [
        JSON.stringify({ sub: IDS.ownerA, role: 'authenticated', session_id: otherSession }),
      ]);
      const crossSession = (await c.query<{ ok: boolean }>(`select private.privileged_session_verified() ok`)).rows[0].ok;

      const provedSession = fixtureSessionId(IDS.ownerA);
      await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [IDS.ownerB]);
      await c.query(`select set_config('request.jwt.claims',$1,true)`, [
        JSON.stringify({ sub: IDS.ownerB, role: 'authenticated', session_id: provedSession }),
      ]);
      const crossUser = (await c.query<{ ok: boolean }>(`select private.privileged_session_verified() ok`)).rows[0].ok;
      return { crossSession, crossUser };
    });
    expect(result).toEqual({ crossSession: false, crossUser: false });
  });

  it('denies proof when the Auth session is expired', async () => {
    expect(await verified(IDS.ownerA, { authSessionExpired: true })).toBe(false);
  });

  it('denies proof while the Auth account is suspended', async () => {
    expect(await withSession(
      { role: 'authenticated', uid: IDS.ownerA, accountBanned: true },
      async (c) => (await c.query<{ ok: boolean }>(`select private.privileged_session_verified() ok`)).rows[0].ok,
    )).toBe(false);
  });

  it('service grant refuses a session owned by another user', async () => {
    const sid = fixtureSessionId(IDS.ownerA, 'grant-owner');
    await asSuperuser((c) => c.query(
      `insert into auth.sessions(id,user_id,not_after) values ($1,$2,now()+interval '1 day') on conflict do nothing`,
      [sid, IDS.ownerA],
    ));
    await expect(withSession({ role: 'service_role', commit: true }, (c) => c.query(
      `select public.grant_privileged_session_verification($1,$2,'email_code',null)`,
      [sid, IDS.ownerB],
    ))).rejects.toThrow(/active Auth session not found/i);
  });

  it('binds trusted-device proof to the same user and device lifetime, then revokes it on device deletion', async () => {
    const sid = fixtureSessionId(IDS.ownerA, 'trusted-device');
    const device = '83333333-2222-4333-8444-555555555555';
    await asSuperuser(async (c) => {
      await c.query(
        `insert into auth.sessions(id,user_id,not_after)
         values ($1,$2,now()+interval '1 day'),($3,$4,now()+interval '1 day') on conflict do nothing`,
        [sid, IDS.ownerA, fixtureSessionId(IDS.ownerB, 'trusted-device'), IDS.ownerB],
      );
      await c.query(
        `insert into public.trusted_devices(id,user_id,token_hash,expires_at)
         values ($1,$2,'trusted-device-security-test',now()+interval '10 minutes')`,
        [device, IDS.ownerA],
      );
    });

    await expect(withSession({ role: 'service_role', commit: true }, (c) => c.query(
      `select public.grant_privileged_session_verification($1,$2,'trusted_device',$3)`,
      [fixtureSessionId(IDS.ownerB, 'trusted-device'), IDS.ownerB, device],
    ))).rejects.toThrow(/active trusted device not found/i);

    await withSession({ role: 'service_role', commit: true }, (c) => c.query(
      `select public.grant_privileged_session_verification($1,$2,'trusted_device',$3)`,
      [sid, IDS.ownerA, device],
    ));
    const proof = await asSuperuser(async (c) => (
      await c.query<{ bounded: boolean; method: string }>(`
        select v.expires_at <= d.expires_at as bounded,v.method
        from private.privileged_session_verifications v
        join public.trusted_devices d on d.id=v.trusted_device_id
        where v.session_id=$1`, [sid])
    ).rows[0]);
    expect(proof).toEqual({ bounded: true, method: 'trusted_device' });

    await asSuperuser((c) => c.query(`delete from public.trusted_devices where id=$1`, [device]));
    const remaining = await asSuperuser(async (c) => (
      await c.query(`select 1 from private.privileged_session_verifications where session_id=$1`, [sid])
    ).rowCount);
    expect(remaining).toBe(0);
  });

  it('keeps proof rows and mutation RPCs off member/authenticated access', async () => {
    const grants = await asSuperuser(async (c) => {
      const { rows } = await c.query(`
        select grantee,privilege_type from information_schema.role_table_grants
        where table_schema='private' and table_name='privileged_session_verifications'
          and grantee in ('anon','authenticated','service_role')`);
      return rows;
    });
    expect(grants).toEqual([]);

    const functionPrivileges = await asSuperuser(async (c) => (
      await c.query<{ authenticated_can_mutate: boolean; service_can_mutate: boolean; authenticated_can_read_status: boolean }>(`
        select
          bool_or(has_function_privilege('authenticated', f.signature, 'EXECUTE')) as authenticated_can_mutate,
          bool_and(has_function_privilege('service_role', f.signature, 'EXECUTE')) as service_can_mutate,
          has_function_privilege('authenticated', 'public.privileged_session_verified()', 'EXECUTE')
            as authenticated_can_read_status
        from (values
          ('public.grant_privileged_session_verification(uuid,uuid,text,uuid)'),
          ('public.revoke_privileged_session_verification(uuid,uuid)'),
          ('public.revoke_user_privileged_sessions(uuid)'),
          ('public.prune_privileged_session_verifications()'),
          ('public.verify_staff_email_challenge(uuid,text)')
        ) f(signature)`)
    ).rows[0]);
    expect(functionPrivileges).toEqual({
      authenticated_can_mutate: false,
      service_can_mutate: true,
      authenticated_can_read_status: true,
    });

    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (c) => c.query(
      `select public.grant_privileged_session_verification($1,$2,'email_code',null)`,
      [fixtureSessionId(IDS.memberA), IDS.memberA],
    ))).rejects.toThrow(/permission denied/i);
    await expect(withSession({ role: 'authenticated', uid: IDS.memberA }, (c) => c.query(
      `select * from public.verify_staff_email_challenge($1,'nope')`,
      ['81111111-2222-4333-8444-555555555555'],
    ))).rejects.toThrow(/permission denied/i);
  });
});

describe('atomic staff email challenge', () => {
  it('counts failed guesses in the locked row', async () => {
    const challenge = '82222222-2222-4333-8444-555555555555';
    await asSuperuser((c) => c.query(
      `insert into public.auth_challenges(id,user_id,email,code_hash,expires_at)
       values ($1,$2,'ownerA@example.com',$3,now()+interval '10 minutes')`,
      [challenge, IDS.ownerA, hashCode(challenge, '123456')],
    ));
    for (const code of ['000000', '000001']) {
      const result = await withSession({ role: 'service_role', commit: true }, async (c) => (
        await c.query<{ accepted: boolean; reason: string; attempts: number }>(
          `select accepted,reason,attempts from public.verify_staff_email_challenge($1,$2)`,
          [challenge, hashCode(challenge, code)],
        )
      ).rows[0]);
      expect(result).toMatchObject({ accepted: false, reason: 'mismatch' });
    }
    const nullHash = await withSession({ role: 'service_role', commit: true }, async (c) => (
      await c.query<{ accepted: boolean; reason: string }>(
        `select accepted,reason from public.verify_staff_email_challenge($1,$2)`, [challenge, null],
      )
    ).rows[0]);
    expect(nullHash).toEqual({ accepted: false, reason: 'mismatch' });
    const attempts = await asSuperuser(async (c) => (
      await c.query<{ attempts: number }>(`select attempts from public.auth_challenges where id=$1`, [challenge])
    ).rows[0].attempts);
    expect(attempts).toBe(3);
  });

  it('permits exactly one redemption under concurrent replay', async () => {
    const challenge = '81111111-2222-4333-8444-555555555555';
    const expected = hashCode(challenge, '123456');
    await asSuperuser(async (c) => {
      await c.query(`delete from public.auth_challenges where id=$1`, [challenge]);
      await c.query(
        `insert into public.auth_challenges(id,user_id,email,code_hash,expires_at)
         values ($1,$2,'ownerA@example.com',$3,now()+interval '10 minutes')`,
        [challenge, IDS.ownerA, expected],
      );
    });

    const redeem = () => withSession({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ accepted: boolean; reason: string }>(
        `select accepted,reason from public.verify_staff_email_challenge($1,$2)`,
        [challenge, expected],
      );
      return rows[0];
    });
    const outcomes = await Promise.all([redeem(), redeem()]);
    expect(outcomes.filter((x) => x.accepted)).toHaveLength(1);
    expect(outcomes.filter((x) => !x.accepted).map((x) => x.reason)).toEqual(['consumed']);
  });
});

describe('privileged predicate coverage', () => {
  it('has no raw staff/platform RLS predicate outside proof-gated policies and own-link discovery', async () => {
    const uncovered = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ schemaname: string; tablename: string; policyname: string }>(`
        select schemaname,tablename,policyname from pg_policies
        where (coalesce(qual,'') || coalesce(with_check,'')) ~ '(gym_staff_links|platform_admins)'
          and (coalesce(qual,'') || coalesce(with_check,'')) not like '%privileged_session_verified%'
          and policyname not in ('gym_staff_links_select_own','pa_select_self')
        order by 1,2,3`);
      return rows;
    });
    expect(uncovered).toEqual([]);
  });

  it('has no caller-facing raw staff helper without proof', async () => {
    const uncovered = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ schema: string; name: string }>(`
        select n.nspname schema,p.proname name
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and p.prokind='f'
          and p.prosrc ~ '(gym_staff_links|platform_admins)'
          and p.prosrc not like '%privileged_session_verified%'
          and p.prosrc !~ 'private\\.(has_gym_role|is_gym_staff|is_platform_admin)'
          and p.proname <> 'handle_new_user'
        order by 1,2`);
      return rows;
    });
    expect(uncovered).toEqual([]);
  });
});

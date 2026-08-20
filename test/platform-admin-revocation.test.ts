import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Regression: deactivating a platform admin (platform_admins.is_active = false)
// is the ONLY revocation the product offers, and requirePlatformAdmin() honours
// it — but two RLS policies used to test raw membership in platform_admins
// instead of the is_active-gated helper private.is_platform_admin(), so an
// offboarded operator whose auth account still exists could read every gym's
// member/staff PII (public.profiles) and the platform's whole revenue book
// (public.platform_payments) straight off PostgREST, with no app code in the
// path. Fixed in 20260820120000_revoke_deactivated_platform_admin_reads.sql.
//
// Talks to the real Postgres RLS engine (same as tenant-isolation.test.ts): a
// leak here is a leak in production.

const EX_ADMIN = 'ad000000-0000-0000-0000-0000000000ff';

beforeAll(async () => {
  await seed();
  await asSuperuser(async (c) => {
    // Idempotent within a run.
    await c.query(`delete from public.platform_admins where user_id = $1`, [EX_ADMIN]);
    await c.query(`delete from public.platform_payments where gym_id in ($1, $2)`, [IDS.gymA, IDS.gymB]);
    await c.query(`delete from auth.users where id = $1`, [EX_ADMIN]);

    // The ex-admin's auth account survives offboarding. handle_new_user() makes
    // their profile; role 'member' proves the leak came from platform_admins,
    // not the profiles.role='platform_admin' path.
    await c.query(`insert into auth.users (id, email) values ($1, $2)`, [EX_ADMIN, 'ex-admin@gymflow.ng']);
    await c.query(`update public.profiles set role = 'member', gym_id = null where id = $1`, [EX_ADMIN]);

    // Their platform_admins row, deactivated — the product's "access revoked".
    await c.query(
      `insert into public.platform_admins (user_id, name, email, is_active) values ($1, 'Ex Admin', 'ex-admin@gymflow.ng', false)`,
      [EX_ADMIN],
    );

    // One subscription-billing row per gym, so a cross-tenant read is visible.
    for (const gym of [IDS.gymA, IDS.gymB]) {
      await c.query(
        `insert into public.platform_payments (gym_id, amount, payment_status, billing_period_start, billing_period_end)
         values ($1, 13999.00, 'successful', current_date, current_date + 30)`,
        [gym],
      );
    }
  });
});

describe('deactivated platform admin has no cross-tenant read', () => {
  it('the app already treats them as revoked (private.is_platform_admin() = false)', async () => {
    const isAdmin = await withSession({ role: 'authenticated', uid: EX_ADMIN }, async (c) => {
      const { rows } = await c.query<{ ok: boolean }>(`select private.is_platform_admin() as ok`);
      return rows[0].ok;
    });
    expect(isAdmin).toBe(false);
  });

  it('cannot read profiles beyond their own row', async () => {
    const n = await withSession({ role: 'authenticated', uid: EX_ADMIN }, async (c) => {
      const { rows } = await c.query<{ n: string }>(`select count(*) as n from public.profiles`);
      return Number(rows[0].n);
    });
    // Only their own profile — not every gym's members and staff.
    expect(n).toBe(1);
  });

  it('cannot read any platform_payments (the platform revenue book)', async () => {
    const n = await withSession({ role: 'authenticated', uid: EX_ADMIN }, async (c) => {
      const { rows } = await c.query<{ n: string }>(`select count(*) as n from public.platform_payments`);
      return Number(rows[0].n);
    });
    expect(n).toBe(0);
  });
});

describe('the fix does not narrow legitimate access', () => {
  it('a gym owner still reads their own gym’s platform_payments, and only theirs', async () => {
    const gyms = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const { rows } = await c.query<{ gym_id: string }>(`select gym_id from public.platform_payments`);
      return rows.map((r) => r.gym_id);
    });
    expect(gyms).toEqual([IDS.gymA]);
  });

  it('a manager still sees a suspended colleague’s profile (the 20260717 fix is preserved)', async () => {
    // Suspend memberA's link is not staff; use a staff colleague. ownerA (active
    // staff of gym A) must still resolve can_see_profile() for a same-gym member.
    const canSee = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const { rows } = await c.query<{ ok: boolean }>(
        `select public.can_see_profile($1) as ok`, [IDS.memberA],
      );
      return rows[0].ok;
    });
    expect(canSee).toBe(true);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { withSession } from './db';
import { IDS, seed } from './seed';

// The RBAC helpers (has_gym_role / is_gym_staff / is_platform_admin) were moved
// from public to private schema (20260731_normalize_billing migration). They
// are SECURITY DEFINER and are callable over PostgREST only if the caller holds
// EXECUTE on the private schema + function:
//
//   • anon must NOT hold it — private schema USAGE is not granted to anon.
//   • authenticated MUST hold it — ~20 RLS policies call these helpers by OID,
//     and direct calls from the app also need them.
//
// Both halves are asserted here so a future tightening pass can't take the
// second one with it.

beforeAll(async () => { await seed(); });

const HELPERS: Array<{ name: string; call: string }> = [
  { name: 'has_gym_role', call: `select private.has_gym_role('${IDS.gymA}'::uuid, array['gym_owner']::public.user_role[])` },
  { name: 'is_gym_staff', call: `select private.is_gym_staff('${IDS.gymA}'::uuid)` },
  { name: 'is_platform_admin', call: `select private.is_platform_admin()` },
];

describe('RBAC helper RPC surface', () => {
  for (const h of HELPERS) {
    it(`anon cannot execute ${h.name}`, async () => {
      const err = await withSession({ role: 'anon' }, async (c) => {
        try { await c.query(h.call); return null; } catch (e) { return e as { code?: string }; }
      });
      // 42501 (insufficient_privilege) or 42883 (undefined_function) — both
      // mean anon has no access. The exact code depends on whether Postgres
      // checks schema USAGE before function resolution.
      expect(err?.code).toMatch(/^42(501|883)$/);
    });

    it(`authenticated can execute ${h.name}`, async () => {
      const value = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
        const { rows } = await c.query<Record<string, boolean>>(h.call);
        return Object.values(rows[0])[0];
      });
      expect(typeof value).toBe('boolean');
    });
  }

  it('policies that call the helpers still evaluate for authenticated', async () => {
    // gym_staff_links_select_manager calls has_gym_role. If the grant were
    // missing this throws rather than returning rows.
    const gyms = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      const { rows } = await c.query<{ gym_id: string }>(`select distinct gym_id from public.gym_staff_links`);
      return rows.map((r) => r.gym_id);
    });
    expect(gyms).toEqual([IDS.gymA]);
  });

  it('extend_member_sub is reachable by the app roles and by nobody else', async () => {
    // The membership-extension RPC is SECURITY INVOKER, so RLS is what decides
    // whether a caller's UPDATE lands (see test/member-sub-extend.test.ts).
    // What this pins is the surface: anon must not be able to invoke it at all,
    // and both roles the app actually uses must be able to — the staff path
    // calls it as `authenticated` and the two Paystack fulfillers as
    // `service_role`, so losing either grant breaks a money path silently.
    const call = `select public.extend_member_sub('${IDS.gymA}'::uuid, null, 1)`;
    const err = await withSession({ role: 'anon' }, async (c) => {
      try { await c.query(call); return null; } catch (e) { return e as { code?: string }; }
    });
    expect(err?.code).toMatch(/^42(501|883)$/);

    for (const role of ['authenticated', 'service_role'] as const) {
      // A gym id is not a subscription id, so this updates nothing and returns
      // null — which is the point: it got far enough to run.
      const value = await withSession({ role, uid: IDS.ownerA }, async (c) => {
        const { rows } = await c.query(call);
        return Object.values(rows[0])[0];
      });
      expect(value, `${role} must be able to execute extend_member_sub`).toBeNull();
    }
  });

  it('anon can still read the public landing tables (classes, business_hours)', async () => {
    // After tenant isolation hardening, gyms and membership_plans are no
    // longer accessible to anon. Classes and business_hours remain public.
    const counts = await withSession({ role: 'anon' }, async (c) => {
      const { rows } = await c.query<{ classes: string; hours: string }>(`
        select (select count(*) from public.classes) as classes,
               (select count(*) from public.business_hours) as hours`);
      return rows[0];
    });
    expect(Number(counts.classes)).toBeGreaterThanOrEqual(0);
    expect(Number(counts.hours)).toBeGreaterThanOrEqual(0);
  });
});

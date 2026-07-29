import { beforeAll, describe, expect, it } from 'vitest';
import { withSession } from './db';
import { IDS, seed } from './seed';

// The RBAC helpers (has_gym_role / is_gym_staff / is_platform_admin) are
// SECURITY DEFINER and are reachable over PostgREST as /rest/v1/rpc/<name>,
// so who holds EXECUTE is an API-surface decision, not a detail:
//
//   • anon must NOT hold it — 20260728_revoke_public_execute_rbac_helpers.sql
//     dropped the default PUBLIC grant that exposed them to logged-out callers.
//   • authenticated MUST hold it — ~20 RLS policies call these helpers, and a
//     policy expression is evaluated as the querying role. Revoking it there
//     would turn every gated read into "permission denied for function", which
//     is exactly the kind of breakage a blanket lockdown invites.
//
// Both halves are asserted here so a future tightening pass can't take the
// second one with it.

beforeAll(async () => { await seed(); });

const HELPERS: Array<{ name: string; call: string }> = [
  { name: 'has_gym_role', call: `select public.has_gym_role('${IDS.gymA}'::uuid, array['gym_owner']::public.user_role[])` },
  { name: 'is_gym_staff', call: `select public.is_gym_staff('${IDS.gymA}'::uuid)` },
  { name: 'is_platform_admin', call: `select public.is_platform_admin()` },
];

describe('RBAC helper RPC surface', () => {
  for (const h of HELPERS) {
    it(`anon cannot execute ${h.name}`, async () => {
      const err = await withSession({ role: 'anon' }, async (c) => {
        try { await c.query(h.call); return null; } catch (e) { return e as { code?: string }; }
      });
      expect(err?.code).toBe('42501'); // insufficient_privilege
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

  it('anon can still read the public landing tables', async () => {
    // The revoke only bites on tables anon never touches: none of the policies
    // on gyms/membership_plans/classes/business_hours reference the helpers.
    const counts = await withSession({ role: 'anon' }, async (c) => {
      const { rows } = await c.query<{ gyms: string; plans: string; classes: string; hours: string }>(`
        select (select count(*) from public.gyms) as gyms,
               (select count(*) from public.membership_plans) as plans,
               (select count(*) from public.classes) as classes,
               (select count(*) from public.business_hours) as hours`);
      return rows[0];
    });
    expect(Number(counts.gyms)).toBeGreaterThan(0);
  });
});

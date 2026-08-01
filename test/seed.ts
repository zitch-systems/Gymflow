import { asSuperuser } from './db';

// Deterministic UUIDs make assertions readable. Any UUID works.
export const IDS = {
  gymA: '11111111-1111-1111-1111-111111111111',
  gymB: '22222222-2222-2222-2222-222222222222',
  ownerA: 'a1111111-1111-1111-1111-111111111111',
  ownerB: 'a2222222-2222-2222-2222-222222222222',
  memberA: 'b1111111-1111-1111-1111-111111111111',
  memberB: 'b2222222-2222-2222-2222-222222222222',
  planA: 'c1111111-1111-1111-1111-111111111111',
  planB: 'c2222222-2222-2222-2222-222222222222',
} as const;

// Wipe every row that our fixtures create — order matters because of FKs.
// Runs as superuser so RLS doesn't get in the way. Not TRUNCATE because we
// want the auth.users rows and their profile-trigger side effects gone too.
export async function reset() {
  await asSuperuser(async (c) => {
    for (const t of [
      'public.payments', 'public.member_subscriptions', 'public.memberships',
      'public.checkin_codes', 'public.check_ins', 'public.gym_member_links', 'public.gym_staff_links',
      'public.membership_plans', 'public.profiles', 'public.gyms',
    ]) await c.query(`delete from ${t}`);
    await c.query(`delete from auth.users`);
  });
}

// Insert the "two gyms, two members, two owners" tenant-isolation baseline.
// Uses the service-role client so it bypasses RLS (matches how the real app's
// admin.ts writes seed data via createAdminClient).
export async function seed() {
  await reset();
  await asSuperuser(async (c) => {
    // Simulate the auth.users → handle_new_user() → profiles path by inserting
    // the auth row and letting the trigger create the profile. Two owners,
    // two members, each pinned to their gym.
    for (const [id, email] of [
      [IDS.ownerA, 'ownerA@example.com'],
      [IDS.ownerB, 'ownerB@example.com'],
      [IDS.memberA, 'memberA@example.com'],
      [IDS.memberB, 'memberB@example.com'],
    ] as const) {
      await c.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    }

    for (const [id, slug, name] of [
      [IDS.gymA, 'gym-a', 'Gym A'],
      [IDS.gymB, 'gym-b', 'Gym B'],
    ] as const) {
      await c.query(`insert into public.gyms (id, slug, name) values ($1, $2, $3)`, [id, slug, name]);
    }

    // Pin owner profiles' gym_id + role so the profiles.role checks in some
    // policies work (they read 'owner' from the text column).
    await c.query(`update public.profiles set gym_id = $2, role = 'owner' where id = $1`, [IDS.ownerA, IDS.gymA]);
    await c.query(`update public.profiles set gym_id = $2, role = 'owner' where id = $1`, [IDS.ownerB, IDS.gymB]);

    // Staff links (canonical gym_staff_links.role source of truth for RLS).
    for (const [gym, user] of [[IDS.gymA, IDS.ownerA], [IDS.gymB, IDS.ownerB]] as const) {
      await c.query(
        `insert into public.gym_staff_links (gym_id, user_id, role, is_active)
         values ($1, $2, 'gym_owner', true)`,
        [gym, user],
      );
    }

    // Member links.
    for (const [gym, user] of [[IDS.gymA, IDS.memberA], [IDS.gymB, IDS.memberB]] as const) {
      await c.query(
        `insert into public.gym_member_links (gym_id, user_id, member_id, is_active)
         values ($1, $2, $2, true)`,
        [gym, user],
      );
      await c.query(`update public.profiles set gym_id = $2 where id = $1`, [user, gym]);
    }

    // A plan per gym so cross-gym plan tests have something to point at.
    for (const [id, gym, name] of [
      [IDS.planA, IDS.gymA, 'Monthly A'],
      [IDS.planB, IDS.gymB, 'Monthly B'],
    ] as const) {
      await c.query(
        `insert into public.membership_plans (id, gym_id, name, duration_months, price)
         values ($1, $2, $3, 1, 10000)`,
        [id, gym, name],
      );
    }

    // Active subscriptions so check-in triggers (which require an active sub) pass.
    for (const [gym, member, plan] of [
      [IDS.gymA, IDS.memberA, IDS.planA],
      [IDS.gymB, IDS.memberB, IDS.planB],
    ] as const) {
      await c.query(
        `insert into public.member_subscriptions (gym_id, member_id, plan_id, status, start_date, end_date)
         values ($1, $2, $3, 'active', now(), now() + interval '30 days')`,
        [gym, member, plan],
      );
    }

    // One payment per member in their own gym. These become the "does the
    // other gym's staff see it?" fixture.
    for (const [gym, member] of [[IDS.gymA, IDS.memberA], [IDS.gymB, IDS.memberB]] as const) {
      await c.query(
        `insert into public.payments (gym_id, member_id, amount, currency, status, payment_status, paystack_reference)
         values ($1, $2, 10000, 'NGN', 'success', 'successful', $3)`,
        [gym, member, `test-ref-${member}`],
      );
    }
  });
}

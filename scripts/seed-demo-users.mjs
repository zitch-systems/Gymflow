#!/usr/bin/env node
// One-shot seed script: creates 3 demo users in your Supabase project and
// wires them into a gym with appropriate roles. Idempotent — re-running just
// ensures the users + links exist. Designed to be run locally with the
// project's service-role key, NOT shipped to production.
//
//   USAGE:
//     SUPABASE_URL=https://<project>.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//     node scripts/seed-demo-users.mjs [gym-slug]
//
//   If gym-slug is omitted, the script uses LOCAL_DEFAULT_GYM_SLUG or the
//   first gym it finds in the `gyms` table.
//
//   On success it prints the credentials. They're the same every run so you
//   can bookmark them.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Demo users — same credentials every run so they can be bookmarked.
const DEMO_PASSWORD = 'GymFlow-Demo-2026!';
const USERS = [
  { email: 'demo.owner@gymflow.ng',  role: 'gym_owner',  full_name: 'Demo Owner',  description: 'Gym owner — full admin access' },
  { email: 'demo.coach@gymflow.ng',  role: 'instructor', full_name: 'Demo Coach',  description: 'Instructor — coach portal' },
  { email: 'demo.member@gymflow.ng', role: 'member',     full_name: 'Demo Member', description: 'Member — dashboard / check-in / classes' },
];

async function findGym(slugArg) {
  if (slugArg) {
    const { data } = await supabase.from('gyms').select('id, slug, name').eq('slug', slugArg).maybeSingle();
    if (!data) throw new Error(`Gym with slug "${slugArg}" not found`);
    return data;
  }
  const envSlug = process.env.LOCAL_DEFAULT_GYM_SLUG;
  if (envSlug) {
    const { data } = await supabase.from('gyms').select('id, slug, name').eq('slug', envSlug).maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase.from('gyms').select('id, slug, name').limit(1).maybeSingle();
  if (!data) throw new Error('No gyms found in the database — onboard one first');
  return data;
}

async function findUserByEmail(email) {
  // listUsers is paginated, but at the scale this script runs we can scan
  // up to a few pages. For a freshly-seeded project the user is on page 1.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureAuthUser({ email, full_name }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    // Reset the password each run so the documented value below works even
    // if it was rotated.
    await supabase.auth.admin.updateUserById(existing.id, { password: DEMO_PASSWORD, email_confirm: true });
    return { id: existing.id, created: false };
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  return { id: data.user.id, created: true };
}

async function ensureProfile(userId, { email, full_name }) {
  // The handle_new_user trigger normally seeds profiles, but updateUserById
  // doesn't fire it — and a profile may not exist if the row was created
  // before the trigger landed. Upsert defensively.
  await supabase.from('profiles').upsert(
    { id: userId, email: email.toLowerCase(), full_name, is_active: true },
    { onConflict: 'id' },
  );
}

async function ensureMemberLink(userId, gymId) {
  await supabase.from('gym_member_links').upsert(
    {
      gym_id: gymId,
      user_id: userId,
      member_id: userId,
      is_active: true,
      status: 'active',
      onboarding_method: 'demo_seed',
      joined_at: new Date().toISOString(),
    },
    { onConflict: 'gym_id,user_id' },
  );
}

async function ensureStaffLink(userId, gymId, role) {
  await supabase.from('gym_staff_links').upsert(
    { gym_id: gymId, user_id: userId, role, is_active: true },
    { onConflict: 'gym_id,user_id,role' },
  );
}

async function main() {
  const gym = await findGym(process.argv[2]);
  console.log(`\n→ Seeding into gym: ${gym.name} (${gym.slug})\n`);

  const results = [];
  for (const u of USERS) {
    const { id, created } = await ensureAuthUser(u);
    await ensureProfile(id, u);

    if (u.role === 'member') {
      await ensureMemberLink(id, gym.id);
    } else {
      // gym_owner / instructor / manager all live in gym_staff_links.
      await ensureStaffLink(id, gym.id, u.role);
      // Owners also get a member link so the dashboard handles them as
      // self-checkin members too, matching real-world signup flow.
      if (u.role === 'gym_owner') await ensureMemberLink(id, gym.id);
    }

    results.push({ email: u.email, role: u.role, status: created ? 'CREATED' : 'EXISTS · reset' });
  }

  console.log('========================================');
  console.log('  DEMO USERS · password: ' + DEMO_PASSWORD);
  console.log('========================================');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(15)}  ${r.role.padEnd(11)}  ${r.email}`);
  }
  console.log(`\nSign-in URL:  https://${gym.slug}.gymflow.ng/login`);
  console.log('             (or your preview URL / localhost in dev)\n');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

# Resume the GymFlow port

Paste this into a new Claude Code session at the start. Read top to bottom.

> **Status update 2026-05-23 PM:** tasks #11 and #13 were closed after Supabase recovered. The test gym landing was a transient outage symptom, not a real bug. Seed data applied for owner/staff/instructor/platform_admin test users. Two upsert bugs in `lib/actions/instructors.ts` and `lib/actions/platform.ts` fixed (`onConflict: 'gym_id,user_id'` → `'gym_id,user_id,role'`).

## What this project is

**GymFlow** — multi-tenant gym management SaaS for the Nigerian market. Subdomain-per-gym (`{slug}.gymflow.ng`), member PWA + gym admin desktop + instructor PWA + platform superadmin. Stack: Next.js 16 (App Router) · Supabase · Vercel · Paystack · Resend · Termii.

Full spec: `C:\Users\Adeta\Downloads\GymFlow_Master_Project_Document.docx`. Project conventions: `AGENTS.md` at repo root. **Critically: this is Next.js 16, which renamed `middleware.ts` to `proxy.ts`** — don't add a `middleware.ts` file or assume that convention.

## Where we are

- Branch: `nextjs-port` (push to `origin/nextjs-port` on `zitch-systems/Gymflow`)
- Last commit: `b7020ad` — `isPlatformAdmin` helper accepting profile.role OR platform_admins row
- Working tree should be clean apart from `PENDING_SEED.sql` and this file

### Recent commits (this session)

```
b7020ad  isPlatformAdmin helper: accept profile.role OR platform_admins row
cc2e9e7  RLS: tighten profiles_select with can_see_profile helper
7417409  RLS phase 7b: tighten qual:true policies on gym-scoped tables
d04db04  Coach portal + Paystack subaccounts + landing builder + superadmin MRR & member search
8bcf210  P&L + equipment / expense CRUD with photo uploads      (pre-session)
```

## Migrations already applied to remote Supabase

The Supabase project is `kdbbrxqxqewbjoozmfhq` (Gymflow, eu-west-1). These migrations are in `supabase/migrations/` AND have been applied via Supabase MCP `apply_migration`. **Do not re-apply.**

```
20260523_gyms_landing_fields.sql       (landing builder columns)
20260523_handle_new_user_full_signup.sql
20260523_handle_new_user_drop_full_name.sql
20260523_gym_assets_storage.sql
20260524_coach_portal.sql              (instructor_sessions, instructor_payouts, member_id on instructor_subscriptions)
20260524_rls_phase_7a.sql              (policies for 11 zero-policy tables)
20260524_paystack_subaccount.sql       (gyms.paystack_subaccount_code + bank fields)
20260524_rls_phase_7b.sql              (tighten memberships/payments/etc.)
20260524_rls_profiles.sql              (can_see_profile() + profiles_select_scoped)
```

## Open tasks

### #6 — Schema dump to source control (your turn)
Base schema isn't in source control. `supabase/migrations/` only has the recent additions. New environments can't be reproduced. Run:

```
supabase link --project-ref kdbbrxqxqewbjoozmfhq
supabase db dump --schema public > supabase/migrations/20260101000000_baseline.sql
```

Needs the DB password. Verify clean apply on a fresh local Supabase.

### #9b (deferred) — `profiles_select` PII edge cases
`can_see_profile()` covers self + same-gym staff/member + platform_admin. If you find a flow that needs a profile read NOT covered (e.g., a member viewing another member's profile through some feature), extend the helper rather than re-opening the policy.

### Schema quirks worth knowing
- **`profiles.role` is TEXT** with CHECK: `owner | manager | staff | instructor | member | platform_admin`. `'gym_owner'` is NOT allowed here.
- **`gym_staff_links.role` is the `user_role` ENUM**: `gym_owner | manager | front_desk | accountant | instructor | platform_admin | member`. Uses `'gym_owner'` (not `'owner'`).
- **`gym_staff_links` UNIQUE constraint is `(gym_id, user_id, role)`** — a user can hold multiple roles at one gym. Code that upserts with `onConflict: 'gym_id,user_id'` will throw. I fixed this in two places already; if you see it elsewhere, fix it the same way.
- **`platform_admins` requires `name` and `email` NOT NULL** when inserting.
- `isPlatformAdmin()` in `lib/auth/dal.ts` accepts either `profile.role='platform_admin'` OR a `platform_admins` row.

## Run it locally

```
npm install                # if fresh checkout
PORT=3001 npm run dev      # proxy.ts uses LOCAL_DEFAULT_GYM_SLUG (default 'gf-test-gym')
```

Hit:
- `http://localhost:3001/` — platform landing
- `http://localhost:3001/login` — login (proxy routes to test gym login)
- `http://localhost:3001/admin` → 307 → login (auth-gated)
- `http://localhost:3001/coach` → 307 → login (auth-gated)
- `http://localhost:3001/gym/gf-test-gym` — public gym landing (currently 404 until `PENDING_SEED.sql` runs)

Playwright e2e exists at `tests/e2e/` with `signUpMember` / `signIn` helpers. Member signup creates a real auth.users row and sends a welcome email via Resend — use unique emails.

## Conventions I picked up that aren't in AGENTS.md

- **Server actions** use `revalidatePath(\`/gym/${slug}/...\`)` with the **rewritten** path, not the user-facing path. `revalidatePath('/')` does NOT revalidate `slug.gymflow.ng/` because proxy.ts rewrites that to `/gym/${slug}/`.
- **Admin queries that need cross-gym data** use `createAdminClient()` (service_role, bypasses RLS). User-scoped queries use `createClient()` from `lib/supabase/server.ts`.
- **Role checks**: `requireMember(slug)`, `requireStaff(slug)`, `requireInstructor(slug)` in `lib/auth/gym.ts`. `isPlatformAdmin()` in `lib/auth/dal.ts`. Don't check `profile.role` directly in new code.
- **RLS is enabled on every table.** Most tables have policies, but a few (classes, class_schedules, membership_plans, gyms, waivers) intentionally have `qual:true` SELECT so the public gym landing page can render without auth. Don't tighten those without thinking about the public-readable case.
- **Migration workflow**: write the SQL file in `supabase/migrations/YYYYMMDD_name.sql`, then apply via Supabase MCP `apply_migration` with the same body. Mark the file with a comment noting it was applied via MCP if you want to match the existing style.
- **PowerShell on Windows**: this repo runs on Windows. Use the Bash tool for POSIX scripts but PowerShell when Windows-specific (no `&&` chaining in PS 5.1).

## Useful commands

```
npx tsc --noEmit                                              # typecheck (run this often)
git log --oneline @{u}..                                      # what's unpushed
git diff --stat origin/main...HEAD                            # full delta from main
```

## What I'd do first in a new session

1. `cd C:\Users\Adeta\gymflow && git status` — confirm clean tree
2. Read this file. Read `AGENTS.md`.
3. Check Supabase is reachable: `curl -s -o /dev/null -w "%{http_code}" https://kdbbrxqxqewbjoozmfhq.supabase.co/rest/v1/` (401 = up, 522 = down).
4. `PORT=3001 npm run dev`, hit `http://localhost:3001/gym/gf-test-gym` — expect 200.
5. Pick a remaining task (#6 schema dump is the obvious next one).

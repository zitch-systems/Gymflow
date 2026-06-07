# Resume the GymFlow build

Paste this into a new Claude Code session at the start. Read top to bottom.

> **Status update 2026-05-31:** Project is feature-complete through **v2.5** and
> green on every local gate (typecheck, 578 unit tests, lint, `next build`).
> What remains is go-live configuration + ops, not application code. See
> "Readiness" below. CONTINUE.md was rewritten this session — the previous
> version was stale (it described the `nextjs-port` branch and listed the
> baseline-schema dump as open; that's since been committed as
> `supabase/migrations/20260101000000_baseline.sql`).

## What this project is

**GymFlow** — multi-tenant gym management SaaS for the Nigerian market.
Subdomain-per-gym (`{slug}.gymflow.ng`), member PWA + gym admin desktop +
instructor/coach PWA + platform superadmin. Stack: Next.js 16 (App Router) ·
React 19 · Supabase · Vercel · Paystack · Resend · Termii.

Project conventions: `AGENTS.md` at repo root. **Critically: this is Next.js
16, which renamed `middleware.ts` to `proxy.ts`** — don't add a `middleware.ts`
file or assume that convention. Read the bundled guides in
`node_modules/next/dist/docs/` before writing framework code.

## Readiness — what's actually left

The app itself is done and verified locally. Remaining work is **deployment
configuration**, tracked in the "Going-live checklist" in `README.md`:

- **Env vars (Vercel):** live Paystack keys, `SUPABASE_SERVICE_ROLE_KEY`,
  Resend (`RESEND_API_KEY` + verified sending domain), Termii, `CRON_SECRET`,
  `NEXT_PUBLIC_SITE_URL`; optional Sentry + PostHog DSNs.
- **Supabase:** apply all migrations in `supabase/migrations/`; enable email
  signups + **leaked-password protection**; re-enable "Confirm email" for prod;
  set the Paystack webhook URL to `/api/paystack/webhook`.
- **DNS:** add the `*.gymflow.ng` wildcard domain and point it at Vercel for
  real subdomain tenancy.
- `npm audit` reports 4 moderate advisories — review before launch.

## Local gates (all green as of 2026-05-31)

```
npm install            # fresh container has no node_modules — install first
npx tsc --noEmit       # 0 errors
npx vitest run         # 578 passed / 58 files
npx eslint             # 0 errors
npx next build         # succeeds
```

> Note: the `GymFlow Design System/` directory is a standalone HTML/CSS/React
> reference snapshot, not part of the app. It's excluded from `tsconfig.json`
> and `eslint.config.mjs` so it doesn't pollute CI. Don't import from it.

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
- `http://localhost:3001/gym/gf-test-gym` — public gym landing (needs `PENDING_SEED.sql`)

Playwright e2e lives at `tests/e2e/` with `signUpMember` / `signIn` helpers.
Member signup creates a real auth.users row and sends a welcome email via
Resend — use unique emails. `PENDING_SEED.sql` seeds the test gym + role users
(idempotent; safe to re-run).

## Schema quirks worth knowing

- **`profiles.role` is TEXT** with CHECK: `owner | manager | staff | instructor
  | member | platform_admin`. `'gym_owner'` is NOT allowed here.
- **`gym_staff_links.role` is the `user_role` ENUM**: `gym_owner | manager |
  front_desk | accountant | instructor | platform_admin | member`. Uses
  `'gym_owner'` (not `'owner'`).
- **`gym_staff_links` UNIQUE constraint is `(gym_id, user_id, role)`** — a user
  can hold multiple roles at one gym. Upserts must use
  `onConflict: 'gym_id,user_id,role'`, not `'gym_id,user_id'`.
- **`platform_admins` requires `name` and `email` NOT NULL** when inserting.
- `isPlatformAdmin()` in `lib/auth/dal.ts` accepts either
  `profile.role='platform_admin'` OR a `platform_admins` row.

## Conventions not in AGENTS.md

- **Server actions** use `revalidatePath(\`/gym/${slug}/...\`)` with the
  **rewritten** path, not the user-facing path. `revalidatePath('/')` does NOT
  revalidate `slug.gymflow.ng/` because proxy.ts rewrites that to `/gym/${slug}/`.
- **Cross-gym/admin queries** use `createAdminClient()` (service_role, bypasses
  RLS). User-scoped queries use `createClient()` from `lib/supabase/server.ts`.
- **Role checks**: `requireMember(slug)`, `requireStaff(slug)`,
  `requireInstructor(slug)` in `lib/auth/gym.ts`; `isPlatformAdmin()` in
  `lib/auth/dal.ts`. Don't check `profile.role` directly in new code.
- **RLS is enabled on every table.** A few (classes, class_schedules,
  membership_plans, gyms, waivers) intentionally keep a `qual:true` SELECT so
  the public gym landing renders without auth — don't tighten those without
  considering the public-readable case.
- **Migrations**: write `supabase/migrations/YYYYMMDD_name.sql`, then apply via
  the Supabase MCP `apply_migration` with the same body.

## Useful commands

```
npx tsc --noEmit                          # typecheck
npx vitest run                            # unit tests
git log --oneline @{u}..                  # what's unpushed
git diff --stat origin/main...HEAD        # full delta from main
```

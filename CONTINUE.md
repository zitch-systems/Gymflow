# GymFlow — state of the project & how to continue

Multi-tenant gym-management SaaS: Next.js 16 (App Router, RSC + Server Actions),
Supabase (Postgres + RLS), Paystack (member→gym charges *and* platform SaaS
billing), Resend (transactional email), deployed on Vercel with subdomain
tenancy (`<slug>.gymflow.ng`).

The product is **built and wired end to end** — all six surfaces, real data, real
money paths. What follows is the current state, the verification commands, and
the work that is deliberately still open.

## Surfaces (all data-backed, gated by role)

72 page routes in total:

| Surface | Pages | Group / namespace | Gate |
|---|---|---|---|
| Marketing | 8 | top-level in `app/` (`/`, `/features`, `/pricing`, …) | public |
| Auth | 5 | `/login` `/signup` `/forgot-password` `/reset-password` `/verify` | public |
| Gym landing | `/g/[slug]`, `/join/[slug]`, `/launch` | subdomain rewrite in `middleware.ts` | public |
| Member PWA | 12 | `app/(member)` · `.ds-member` | `requireMember` |
| Admin | 25 | `app/(admin)` · `.ds-admin` | `requireStaff` / `ADMIN_ROLES` |
| Instructor | 8 | `app/(coach)` · `.ds-admin` | `requireInstructor` |
| Superadmin | 9 | `app/(superadmin)` · `.ds-admin` | `requirePlatformAdmin` |

Role gates live in `lib/auth/dal.ts` (all `cache()`-wrapped); RLS is the
authority on writes. Demo logins (password `Gymflow2026!`):
member@ifitness.com → `/dashboard` · admin@ifitness.com → `/admin` ·
instructor@ifitness.com → `/coach` · admin@gymflow.ng → `/superadmin`.

## Commands

```
npm install
npm run lint
npm run type-check      # tsc for app + tests
npm test                # vitest; builds a throwaway Postgres from the migrations
npm run build           # verifies every route compiles + prerenders
```

`npm test` needs a local Postgres (`POSTGRES_HOST`/`PORT`/`USER`/`PASSWORD`,
defaults match the CI service). It rebuilds `gymflow_test` from
`supabase/migrations/` on every run, so the DR restore path is exercised
continuously — and the RLS tests run against the real policy engine.

## Database

- **The migrations are the schema.** `00000000000000_baseline_schema.sql`
  reconstructs the full live schema (44 tables, enums, functions, triggers, 105
  RLS policies, grants); dated files layer on top. Live project:
  `kdbbrxqxqewbjoozmfhq` (Postgres 17).
- **Drift gate** (`.github/workflows/ci.yml` → `schema-drift`): builds a shadow
  DB from the migrations, fingerprints both it and the live database
  (`scripts/schema-fingerprint.sql`), and fails on any difference. The
  fingerprint compares object *names and shapes* **and** hashes of policy
  predicates and function bodies — a `drop policy` / `create policy` pair that
  keeps the name but changes the predicate is otherwise invisible.
  Needs the `SUPABASE_DB_URL` repo secret; without it the job warns on PRs and
  fails on `main`.
- **Applying migrations:** `supabase db push`. Verify afterwards by diffing the
  fingerprint (see `docs/DR_RUNBOOK.md` §1.4) — counting policies is not enough.

> Lesson worth keeping: three security migrations (`20260716_prelaunch_hardening`,
> `20260716_rbac_access_view_fixes`, `20260717_can_see_profile_inactive_staff`)
> sat in the repo unapplied on the live project for two weeks. One of them was
> closing a tenant-takeover hole. Nothing caught it: the drift gate had no live
> credentials, and even with them it only compared names. Both halves are fixed,
> and `test/rbac-policies.test.ts` now asserts the behaviour of each policy.

## Environment

`.env.example` is the tracked inventory; `docs/DR_RUNBOOK.md` §4 explains what
breaks when each is missing. Everything degrades cleanly (fail-open, "not set"
badges) rather than crashing when a key is absent.

Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`,
`PAYSTACK_PLAN_*`, `CRON_SECRET`, `RESEND_API_KEY`, `SUPABASE_AUTH_HOOK_SECRET`,
`RESEND_WEBHOOK_SECRET`, `TERMII_API_KEY`, `SENTRY_DSN`.
Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_ROOT_DOMAIN`.

Paystack webhook → `/api/paystack/webhook` (HMAC-SHA512, timing-safe compare,
replay ledger, idempotent on reference). Cron → `/api/cron` (constant-time
`CRON_SECRET`).

## Deliberately still open

Ordered by value, per `REVIEW_ENTERPRISE_HARDENING.md` §7 (whose P0/P1 list is
otherwise shipped):

- **Web Push** — in-app notifications + inbox exist; no VAPID/Web Push. Note
  `public/sw.js` deliberately never caches page HTML (PII on shared devices), so
  a richer offline mode would reverse a security decision.
- **Passkeys / WebAuthn** — nothing today; staff sign-in has an emailed-code
  second factor with trusted devices (`lib/auth/two-factor.ts`). Non-trivial on
  Supabase Auth.
- **Per-role permissions for `front_desk` / `accountant`** — both currently see
  the full admin surface; the RLS role arrays already distinguish them.
- **Family plans**, **churn/lifecycle analytics**, **NFC access**,
  **OpenTelemetry**, **queue infrastructure** — genuine gaps, none blocking.

Reference docs: `AUDIT.md` (2026-06-28 full-stack audit),
`REVIEW_ENTERPRISE_HARDENING.md` (adversarial review of a hardening prompt, with
the codebase-grounded priority list), `docs/DR_RUNBOOK.md`, `docs/EMAIL.md`,
`design/` (the original prototype bundle the UI was built from).

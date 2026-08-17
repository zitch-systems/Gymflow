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
authority on writes.

**The platform console is not at `/superadmin`.** It answers on a secret path
set per deployment in `SUPERADMIN_PATH` (`lib/superadmin-path.ts`); the
middleware rewrites `/<segment>/…` onto the internal `/superadmin` route and
404s anyone asking for `/superadmin` directly — byte-identically to any
made-up path, so a probe learns nothing. Nothing links to it: the marketing
footer's "Platform admin" link is gone and robots.txt names neither path. A
platform admin finds it by signing in — `/launch` redirects them there. Every
in-console link is built with `sa()`; a literal `/superadmin` href still works
in dev (where the env var is usually unset and the path falls back) but would
dead-end in production, so `test/superadmin-path.test.ts` fails the build on
one. Rotating the URL is an env change plus a redeploy — no file moves, because
the route on disk never changes.

An eighth surface isn't a page route: **`mobile/`**, the React Native (Expo)
Android app for members — the member PWA's screens on a native runtime, plus a
camera QR scanner. It holds no Supabase credentials; it signs in through
`/api/app/signin`, keeps the session in the Android keystore, and sends it as
`Authorization: Bearer` to `/api/app/*`, where `requireApiMember()`
(`lib/api-app.ts`) binds the token to a Supabase client so RLS authorises every
read and write exactly as it does on the web. The rules the two runtimes must
agree on — entry gates, class capacity, renewal pricing — live in
`lib/checkin-core.ts`, `lib/booking-core.ts` and `lib/renew-core.ts`, which the
web Server Actions and the mobile endpoints both call.
`test/mobile-api.test.ts` locks both properties: no unlisted endpoint may skip
authentication, and no caller may grow its own copy of a rule. Root
`tsconfig.json` / `eslint.config.mjs` exclude `mobile/` — it has its own Expo
toolchain (`cd mobile && npm run type-check && npm run lint`). See
`mobile/README.md`.

Each role lands somewhere different after sign-in — `/launch` routes by role:
platform admin → `/superadmin`, staff → `/admin` (instructor → `/coach`),
member → `/dashboard`. Credentials for the accounts that exercise those paths
are NOT kept here. A shared password written down in the repo is a password in
git history forever, and the one that used to sit on this line opened the
platform-admin account — which reads every tenant's members, payments and
payout details. Ask whoever holds the credential store.

`gyms.status` is the platform's off switch for a tenant (`suspended` /
`terminated`, set from `/superadmin/gyms/[id]`). One predicate — `lib/gym-status.ts`
— and every gym resolver goes through it: the public landing and its QR routes,
`/join`, the mobile `/api/app/*` endpoints, the branded subdomain login, the
sitemap, member checkout and check-in, and the nightly cron's outbound mail. It
used to be an inline `status === 'suspended'` in five render guards, which meant
a suspended gym still took signups, still opened Paystack checkouts settling to
its own subaccount, and still sent gym-branded email; `terminated` was checked
nowhere at all. `test/gym-status.test.ts` locks the call-site list, because the
bug was never the comparison — it was the resolvers that never made one.

What this is *not*: a defence against the gym's own staff. Suspension hides the
console (`SuspendedWall`) and blocks the public and the money, but staff Server
Actions still run — layouts don't execute for Server Action invocations, and RLS
does not model status. That is a deliberate line: suspension is a commercial
lever against an account holder who already owns the data, not a containment
boundary against them. If it ever needs to be one, it belongs in RLS.

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

- **The migrations are the schema.** `00000000000000_baseline_schema.sql` is a
  snapshot — 35 tables, 95 RLS policies, plus enums, functions, triggers and
  grants — and the dated files layer on top of it. It is not a picture of live
  on its own: live currently holds 46 tables and 99 policies, and that gap is
  the dated migrations, not drift. Don't hard-code either number into a check;
  compare fingerprints (below). Live project: `kdbbrxqxqewbjoozmfhq`
  (Postgres 17).
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
- **Mobile app gaps** — the Android member app ships without freeze requests,
  waiver signing or document viewing (each needs a staff-mediated or signature
  flow; the profile screen links out to the web portal for them), and without
  push notifications. Its 2FA position is inherited from `/api/app/signin`:
  an account that owes a second factor is refused a mobile session outright,
  so a coach who also trains at their own gym can't use the app until that
  endpoint grows a challenge/verify pair.

Reference docs: `AUDIT.md` (2026-06-28 full-stack audit),
`REVIEW_ENTERPRISE_HARDENING.md` (adversarial review of a hardening prompt, with
the codebase-grounded priority list), `docs/DR_RUNBOOK.md`, `docs/EMAIL.md`,
`design/` (the original prototype bundle the UI was built from).

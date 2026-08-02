# GymFlow — Disaster Recovery Runbook

**Scope:** total or partial loss of the production Supabase project, the Vercel
deployment, or Paystack configuration. Written against the repo at the commit
that ships it; the repo is the recovery source of truth.

**RTO target:** ≤ 4 hours for a full rebuild. **RPO:** bounded by Supabase's
backup cadence (daily on free/pro tiers; PITR if enabled) — see §5.

---

## 0. What the repo can and cannot restore

| Asset | Restorable from repo? | Source |
|---|---|---|
| Database schema (35 tables, enums, functions, triggers, view) | ✅ | `supabase/migrations/00000000000000_baseline_schema.sql` |
| RLS policies (~95) + role grants | ✅ | same baseline + incremental migrations |
| Incremental schema changes | ✅ | `supabase/migrations/2026*.sql`, sorted order |
| App code + config | ✅ | this repo (`main`) |
| **Data** (rows: gyms, members, payments…) | ❌ | Supabase backups only (§5) |
| **Secrets** (service-role key, Paystack keys, CRON_SECRET) | ❌ | Vercel env + password manager (§4) |
| Paystack objects (plans, subaccounts, subscriptions, recipients) | ❌ | live in Paystack; codes are cached in DB columns and recoverable from the Paystack dashboard |
| `gym-assets` storage bucket contents | ❌ | Supabase storage backups |

The schema-restore path below is exercised **on every CI run**: the test
harness (`test/setup/global.ts`) rebuilds a database from the baseline + all
incrementals before any test executes. If CI is green, the rebuild path works.

---

## 1. Rebuild the database (new Supabase project)

1. Create a new Supabase project (region `eu-west-1` to match latency
   assumptions). Note the project ref, anon key, service-role key, and DB
   password.
2. Link and push the checked-in migrations, in filename order:

   ```bash
   supabase link --project-ref <new-ref>
   supabase db push          # applies supabase/migrations/* in sorted order
   ```

   The baseline is idempotent (`if not exists` / guarded `do $$` blocks), so a
   partially-applied run can be safely re-pushed.
3. Verify RLS coverage — this must return **0 rows**:

   ```sql
   select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
   ```
4. Verify policy count is in the expected range (95 at baseline; more if later
   migrations added policies):

   ```sql
   select count(*) from pg_policies where schemaname = 'public';
   ```
   Counting policies is necessary but not sufficient — a policy can exist with
   the wrong *predicate*. For the real check, fingerprint both sides and diff:

   ```bash
   node scripts/shadow-db.mjs                                  # prints a shadow URL
   psql "$SHADOW_URL" -X -q -f scripts/schema-fingerprint.sql > shadow.txt
   psql "$NEW_DB_URL" -X -q -f scripts/schema-fingerprint.sql > live.txt
   diff -u shadow.txt live.txt                                 # must be empty
   ```
   The fingerprint's `POLICYBODY`/`FUNCTIONBODY` sections hash the predicates
   and function bodies, so a same-named policy with a stale definition fails
   the diff. Run the shadow on the **same Postgres major** as the target.
5. Recreate the `gym-assets` storage bucket (public) — bucket creation isn't
   in migrations; the policy lockdown for it is
   (`20260620_restrict_gym_assets_bucket.sql` re-applies on push).

## 2. Restore data

- **Same-project recovery** (bad deploy / bad migration, project still alive):
  use Supabase Dashboard → Database → Backups → restore, or PITR to a
  timestamp just before the incident. Nothing else to do — schema and data
  restore together.
- **New-project recovery**: restore the latest logical backup
  (`supabase db dump --data-only` artifact if you keep them, else the
  dashboard backup download) **after** §1, with triggers disabled during load:

  ```bash
  psql "$NEW_DB_URL" -c 'set session_replication_role = replica;' \
       -f data_dump.sql
  ```

  `session_replication_role = replica` prevents the membership-sync and
  audit triggers from double-firing while rows are replayed.
- `auth.users` is managed by Supabase Auth — use the dashboard's auth backup
  or ask users to re-register with the same email (profiles rows survive and
  re-link by `profiles_id_fkey` only if auth UIDs are preserved; a plain SQL
  dump of `auth.users` keeps UIDs stable).

## 3. Redeploy the app

1. Vercel project → set env vars (§4) → redeploy `main`. No build-time
   secrets are required beyond the `NEXT_PUBLIC_*` placeholders, so the build
   cannot fail on missing server keys.
2. Wildcard domain `*.gymflow.ng` + apex must both point at Vercel for
   per-gym subdomains to resolve.

## 4. Secrets inventory (what must exist in Vercel env)

From `.env.example` — keep real values in the team password manager, never in
the repo:

| Var | Purpose | Blast radius if lost |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client DB access | app down |
| `SUPABASE_SERVICE_ROLE_KEY` | webhook/cron/admin writes | payments stop recording; regenerate in Supabase dashboard |
| `PAYSTACK_SECRET_KEY` / `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | charges + webhook HMAC | checkout down; regenerate in Paystack dashboard (webhook signature changes with it) |
| `PAYSTACK_PLAN_STARTER/GROWTH/SCALE` | platform SaaS plans | gym billing checkout returns "not set up" |
| `CRON_SECRET` | authorizes `/api/cron` | reminders/expiry sweeps stop; rotate freely |
| `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_ROOT_DOMAIN` | callbacks + subdomains | Paystack callbacks misroute |
| `RESEND_API_KEY` / `RESEND_FROM` / `EMAIL_TENANT_DOMAIN` | transactional + gym-branded email | email silently skipped (fail-open); reminders/receipts stay in-app only |
| `SUPABASE_AUTH_HOOK_SECRET` / `RESEND_WEBHOOK_SECRET` | branded auth mail, bounce ledger | hook 501s and Supabase's default templates take over; bounces stop being suppressed |
| `TERMII_API_KEY` | WhatsApp/SMS reminders (Growth+) | WhatsApp sends skipped (fail-open) |
| `SENTRY_DSN` | server error forwarding + CSP reports | errors land in `client_errors` only |

Repo-side (GitHub → Settings → Secrets → Actions), not Vercel:

| Secret | Purpose | If unset |
|---|---|---|
| `SUPABASE_DB_URL` | applies migrations to live on merge to `main`, and the schema-drift gate's live-side connection | **migrations never reach production.** The `migrate` job fails on every push to `main`; on PRs the drift gate skips with a warning (forks never get secrets) |

## 4a. How migrations reach production

`main` is the deploy trigger. On every push to it, after `verify` (lint,
type-check, the RLS suite and a build) passes, the **`migrate` job**:

1. runs `node scripts/migrate.mjs --dry-run` so the plan is in the log,
2. applies every pending migration — each in its own transaction, in filename
   order, behind a Postgres advisory lock,
3. rebuilds the shadow DB from the migrations and diffs its fingerprint against
   live, so an apply that didn't achieve what the repo says fails the build.

The ledger is `supabase_migrations.repo_migrations (filename, checksum,
applied_at)`, **keyed on filename, not the numeric prefix**: 39 of this repo's
migrations share 8-digit date prefixes (`20260713_*` alone is seven files), so a
version-keyed ledger — which is what `supabase db push` uses — would record one
file per date and silently treat its siblings as applied. The CLI's own
`schema_migrations` table is left alone as the historical record.

Locally / by hand:

```
npm run db:migrate:dry     # show the plan, change nothing
npm run db:migrate         # apply pending migrations
npm run db:baseline        # record every migration as applied WITHOUT running
                           # it — only for a database already at head
```

All three read `SUPABASE_DB_URL` (or `DATABASE_URL`).

**Migrations are immutable once applied.** The runner stores a checksum and
refuses to run if an already-applied file's contents changed — correct a
migration by adding a new one, never by editing history.

## 4b. Supabase project settings (not captured by migrations)

Restoring the schema does not restore project configuration. After §1, in the
Supabase dashboard:

- **Authentication → Providers → Email**: enable **leaked-password protection**
  (HaveIBeenPwned check) and confirm the minimum password length matches
  `lib/auth/password.ts`.
- **Authentication → URL Configuration**:
  - **Site URL** must be `https://<site>` (e.g. `https://gymflow.ng`). A fresh
    project defaults this to its own `https://<ref>.supabase.co` URL, which
    Supabase passes to the Send-email hook as `site_url`; the confirmation link
    is then built against it and every member's link dies with
    `{"message":"No API key found in request"}`. The hook now refuses a
    `*.supabase.co` base and prefers `NEXT_PUBLIC_SITE_URL` (see `docs/EMAIL.md`
    §5), but set this field correctly regardless.
  - **Redirect allow-list** must include `https://<root-domain>/**` *and*
    `https://*.<root-domain>/**`, or per-gym subdomain sign-in links break.
- **Authentication → Emails → Hooks → Send email**: point at
  `https://<site>/api/auth/email-hook` and paste the generated secret into
  `SUPABASE_AUTH_HOOK_SECRET` verbatim (`v1,whsec_…` prefix included) — see
  `docs/EMAIL.md` §5.
- **Storage**: recreate the public `gym-assets` bucket (§1.5).

## 5. Re-point Paystack

1. Dashboard → Settings → Webhooks → set to
   `https://<site>/api/paystack/webhook`. The handler verifies HMAC-SHA512
   with `PAYSTACK_SECRET_KEY`, so the key in Vercel must match the account.
2. Paystack objects survive independently of our infrastructure: Plans
   (platform tiers + per-membership-plan auto-renew plans), gym subaccounts,
   member/gym subscriptions, and transfer recipients all keep working. Their
   codes are cached in DB columns (`gyms.paystack_*`,
   `membership_plans.paystack_plan_code`,
   `member_subscriptions.paystack_*`, `instructor_payouts.paystack_*`) — a
   data restore (§2) recovers the linkage. If data is lost but Paystack
   isn't, subscriptions re-link on the next webhook event (the fulfillment
   code falls back to `customer_code` lookup).
3. Missed webhooks during the outage: Paystack retries failed deliveries for
   72 hours. For anything older, replay manually — Dashboard → Webhooks →
   resend, or reconcile from Transactions export against the `payments`
   table (`paystack_reference` is unique; re-received events are idempotent
   no-ops).

## 6. Verification checklist (after any restore)

- [ ] `select count(*) from pg_policies where schemaname='public'` ≥ 95
- [ ] RLS enabled on all public tables (§1.3 query returns 0 rows)
- [ ] Sign in with a demo/staff account; member dashboard renders real data
- [ ] `npm test` against a branch DB (or trust CI) — tenant isolation green
- [ ] Paystack test-mode charge end-to-end: renew → checkout → webhook →
      `payments` row + `member_subscriptions.end_date` extended
- [ ] `/api/cron` responds 401 without `CRON_SECRET`, 200 with it
- [ ] Audit log viewer (`/superadmin/audit`) shows the post-restore writes

## 7. Rehearsal cadence

- **Continuous (automated):** CI rebuilds the schema from migrations on every
  PR — the §1 path never rots.
- **Quarterly (manual, ~30 min):** create a throwaway Supabase project,
  run §1 + §2 against the latest backup download, run the §6 checklist,
  delete the project. Record date + outcome at the bottom of this file.

| Date | Operator | Outcome |
|---|---|---|
| _none yet_ | | |

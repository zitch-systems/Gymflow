# GymFlow — Disaster Recovery Runbook

**Scope:** total or partial loss of the production Supabase project, the Vercel
deployment, or Paystack configuration. Written against the repo at the commit
that ships it; the repo is the recovery source of truth.

**Planning targets, not yet proven:** RTO ≤ 4 hours for a full rebuild; RPO ≤
24 hours only when a paid project's daily backups are verified, or the actual
PITR recovery window when PITR is enabled. Free projects do not receive the
paid daily-backup entitlement and require operator-managed off-site dumps.
No full restore rehearsal is recorded in §7 yet, so do not present either
target as achieved until one measures it.

---

## 0. What the repo can and cannot restore

| Asset | Restorable from repo? | Source |
|---|---|---|
| Database schema (tables, enums, functions, triggers, views) | ✅ | baseline plus ordered `supabase/migrations/*` |
| RLS policies (95) + role grants | ✅ | same baseline + incremental migrations |
| Incremental schema changes | ✅ | `supabase/migrations/2026*.sql`, sorted order |
| App code + config | ✅ | this repo (`main`) |
| **Data + Auth identities** (public/auth/storage rows) | ✅ when an encrypted operator artifact exists | `pnpm dr:backup` creates a portable, encrypted data-only dump (§2a). Dashboard backups/PITR remain the primary same-project recovery path. |
| **Secrets** (service-role key, Paystack keys, CRON_SECRET) | ❌ | Vercel env + password manager (§4) |
| Paystack objects (plans, subaccounts, subscriptions, recipients) | ❌ | live in Paystack; codes are cached in DB columns and recoverable from the Paystack dashboard |
| Storage bucket objects | ✅ when an encrypted operator artifact exists | `pnpm dr:backup` downloads every object into the encrypted artifact; the database dump carries Storage metadata. |

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
- **New-project recovery**: apply the schema from §1, then use the encrypted,
  isolated restore in §2a. Do not assume a dashboard backup is downloadable:
  current physical backups and PITR restore within the platform, while a
  portable new-project artifact must be created and retained separately.
- **From a per-gym backup zip** (one tenant lost their data, the project is
  fine): follow `docs/RESTORE.md`. It is not a substitute for either path
  above — the archive carries no credentials and no storage objects, and its
  ids need handling before anything is loaded.
- The portable artifact includes `auth.users` rows so UIDs remain stable. A
  per-gym CSV archive does not include Auth and cannot reconstruct identities.

### 2a. Portable encrypted backup and isolated restore

The repository now provides a runnable portable path for the database, Auth
rows, Storage metadata and Storage objects. It does not copy secret values;
the artifact manifest records only whether each required secret was configured,
plus safe public URLs. Install PostgreSQL client tools (`pg_dump`/`pg_restore`)
and keep the passphrase in the credential manager, separate from the artifact.

```bash
export SUPABASE_DB_URL='postgresql://…'
export NEXT_PUBLIC_SUPABASE_URL='https://<source-ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='…'
export DR_BACKUP_PASSPHRASE='at-least-20-characters-from-the-vault'
pnpm dr:backup -- --output ./gymflow-dr-$(date +%F).tgz.enc

# Read/decrypt/authenticate the artifact and inspect its manifest. No writes.
pnpm dr:verify -- --archive ./gymflow-dr-2026-10-02.tgz.enc
```

The backup command proves that `SUPABASE_DB_URL` and
`NEXT_PUBLIC_SUPABASE_URL` identify the same project before reading either
source. Direct database hosts must contain the exact project ref; Supavisor
pooler connections must use the exact `postgres.<project-ref>` username.
Loopback API and database hosts are accepted only for disposable local drills.
This prevents a stale shell from combining one project's database/Auth rows
with another project's Storage objects or recording the wrong source project
in the restore guard.

Remote API endpoints must be a bare HTTPS project origin: no credentials,
path, query, or fragment are accepted. Database endpoints must use PostgreSQL
and name a database. Storage backup and restore requests refuse redirects so a
project or proxy response cannot forward the service-role API key to another
origin. Disposable loopback drills may use HTTP; remote projects may not.

The artifact format is `GFDR0001`: a gzip tar encrypted with AES-256-GCM. The
key is derived with scrypt (`N=131072, r=8, p=1`), with a fresh 16-byte salt and
12-byte IV per artifact; the 16-byte GCM tag authenticates the full archive.
There is no plaintext fallback. Rotating the passphrase means creating and
verifying a fresh artifact; retain an old passphrase until every artifact under
it has expired.

Restore defaults to verification. Mutation needs a different target project,
the exact `ISOLATED_ONLY` acknowledgement, and separate target credentials:

```bash
# Apply this commit's migrations to a fresh, isolated project first.
export DR_RESTORE_DB_URL='postgresql://…isolated target…'
export DR_RESTORE_SUPABASE_URL='https://<different-ref>.supabase.co'
export DR_RESTORE_SERVICE_ROLE_KEY='…target only…'
export DR_RESTORE_ACK=ISOLATED_ONLY
pnpm dr:restore -- --archive ./gymflow-dr-2026-10-02.tgz.enc
```

The restore refuses the source API host and fails on row collisions instead of
upserting older data over a live tenant. It restores rows and objects, then
prints the remaining project settings/secrets checklist. This tooling makes a
rehearsal runnable; it does **not** certify the RTO/RPO. Record a timed isolated
restore plus the §6 checks in §7 before claiming either target.

## 3. Redeploy the app

1. Vercel project → set env vars (§4), then release `main`. Note the Git
   trigger for `main` is deliberately off (§4a), so a push does not deploy on
   its own: re-run the CI workflow on `main`, or — in a rebuild, when CI cannot
   reach the new project yet — deploy by hand with
   `vercel deploy --prod --token=…` after `vercel link`. No build-time secrets
   are required beyond the `NEXT_PUBLIC_*` placeholders, so the build cannot
   fail on missing server keys.
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
| `SECRETS_ENCRYPTION_KEY` | encrypts provider keys and queued webhook bodies | webhook ingestion returns 503 rather than persist replay credentials in plaintext |
| `DR_BACKUP_PASSPHRASE` | encrypts portable DR artifacts (operator environment) | `dr:backup`/`dr:verify` refuse to run |

Repo-side (GitHub → Settings → Secrets → Actions), not Vercel:

| Secret | Purpose | If unset |
|---|---|---|
| `SUPABASE_DB_URL` | applies migrations to live on merge to `main`, and the schema-drift gate's live-side connection | **migrations never reach production.** The `migrate` job fails on every push to `main`; on PRs the drift gate skips with a warning (forks never get secrets) |

## 4a. How migrations reach production

`main` is the deploy trigger, and the pipeline is strictly ordered:

```
verify  →  migrate  →  deploy
```

After `verify` (lint, type-check, the RLS suite and a build) passes, the
**`migrate` job**:

1. runs `node scripts/migrate.mjs --dry-run` so the plan is in the log,
2. applies every pending migration — each in its own transaction, in filename
   order, behind a Postgres advisory lock,
3. rebuilds the shadow DB from the migrations and diffs its fingerprint against
   live, so an apply that didn't achieve what the repo says fails the build.

Only then does the **`deploy` job** publish to Vercel. **Vercel's own Git
trigger for `main` is switched off** (`vercel.json` → `git.deploymentEnabled.
main: false`) precisely so it cannot race the migration: it used to deploy on
push, in parallel, which left a window where production ran code whose
migration had not landed. That window was real — on 2026-08-20 the app went
live at 13:09:24 UTC calling `public.extend_member_sub` while the function was
not created until 13:12:08, ~2m44s during which every membership renewal would
have failed. A failed migration now means **no deploy at all**.

Consequences worth knowing:

- **A red `migrate` job leaves production on the previous release.** That is the
  intended failure mode — old code against the old schema is coherent; new code
  against the old schema is not.
- **Rollback is still Vercel's Instant Rollback** (Deployments → ⋯ → Rollback),
  but rolling the app back does **not** roll the schema back. Migrations here
  are written additively for exactly this reason: the previous release must keep
  working against the newer schema. A migration that cannot satisfy that needs
  splitting across two releases (add the new shape, deploy, migrate the reads,
  drop the old shape) rather than a rollback.
- **`gymflow-meta-connector` is unaffected** — it has its own `vercel.json`
  under its root directory, ships no migrations, and still deploys from Git.
- **PR previews are unaffected** — `deploymentEnabled` names only `main`.
- The `deploy` job needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`
  in Actions secrets. With the Git trigger off, missing secrets mean production
  stops receiving deploys, so the job fails loudly and names them rather than
  skipping.

The ledger is `supabase_migrations.repo_migrations (filename, checksum,
applied_at)`, **keyed on filename, not the numeric prefix**: 39 of this repo's
migrations share 8-digit date prefixes (`20260713_*` alone is seven files), so a
version-keyed ledger — which is what `supabase db push` uses — would record one
file per date and silently treat its siblings as applied. The CLI's own
`schema_migrations` table is left alone as the historical record.

Locally / by hand:

```
pnpm db:migrate:dry        # show the plan, change nothing
pnpm db:migrate            # apply pending migrations
pnpm db:baseline           # record every migration as applied WITHOUT running
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
      (the baseline's own count; live is higher — 99 as of 2026-08-08 — because
      dated migrations add policies. This is a floor, not an equality check.)
- [ ] RLS enabled on all public tables (§1.3 query returns 0 rows)
- [ ] Sign in as a member and as gym staff; member dashboard renders real data.
      Get the accounts from the credential store — the repo used to name a demo
      login and a shared password, and no longer does. If you reach for a gym
      that is `suspended`/`terminated`, you will meet the wall rather than the
      console (`lib/gym-status.ts`); pick a trading gym for this step.
- [ ] `pnpm test` against a branch DB (or trust CI) — tenant isolation green
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
| 2026-10-02 | automated CI fixture | Synthetic CLI drill passed: encrypted data-only database/Auth/Storage-metadata dump, object download/upload, verification-only no-write check, missing-ack refusal, and disposable PostgreSQL restore. This is not a production snapshot restore and does not measure RTO/RPO. |

The first production-derived rehearsal still requires a current encrypted
artifact and a throwaway Supabase project. Record the artifact timestamp,
restore start/end, source-to-artifact lag (measured RPO), restored row/object
counts, Auth sign-in checks, provider/config checks, and cleanup evidence. A
schema-only test database or the synthetic CI fixture cannot close that gap.

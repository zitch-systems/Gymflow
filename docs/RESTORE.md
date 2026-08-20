# Restoring from a gym backup zip

**Scope:** the per-gym archive produced by Settings → Backups and
`/api/cron/backups` (`lib/backup.ts`) — the file a gym owner downloads or is
emailed. For loss of the whole Supabase project, the app or Paystack, see
`DR_RUNBOOK.md`; that is a different asset and a different procedure.

**Status: this is a manual, operator-run procedure. There is no import
endpoint, and deliberately so** — accepting arbitrary CSV into a live tenant
means arbitrary ids, arbitrary foreign keys and one mis-typed `gym_id` away
from writing another gym's rows. Anyone quoting an RTO for this should quote
the hours a person needs, not a click.

---

## 1. What is actually in the zip

One CSV per table, plus `manifest.json` (which names every file, its row count,
anything that failed to read, and anything cut short by the row cap).

| File | Table | Notes |
|---|---|---|
| `gym.csv` | `gyms` | one row — the gym's own record and settings |
| `plans.csv` | `membership_plans` | |
| `members.csv` | `gym_member_links` + `profiles` | link columns first, then the person's details |
| `staff.csv` | `gym_staff_links` + `profiles` | same shape; `role` is the staff role |
| `subscriptions.csv` | `member_subscriptions` | the live membership record |
| `memberships.csv` | `memberships` | legacy membership rows |
| `payments.csv` | `payments` | |
| `check-ins.csv` | `check_ins` | |
| `classes.csv`, `class-schedules.csv`, `class-bookings.csv` | `classes`, `class_schedules`, `class_bookings` | |
| `personal-training.csv`, `pt-sessions.csv`, `instructor-payouts.csv` | `instructor_subscriptions`, `instructor_sessions`, `instructor_payouts` | |
| `business-hours.csv`, `expenses.csv`, `equipment.csv` | as named | |
| `waiver-signatures.csv` | `waiver_signatures` | includes the signature itself |

**Read `manifest.json` first.** A file whose entry carries `error` is missing
from this archive entirely; one carrying `truncated_at` holds only the most
recent 50,000 rows of that table. Neither is visible from the CSV itself.

## 2. What this file CANNOT restore

Say this out loud to whoever is asking for the restore, before starting:

- **Sign-ins.** The archive holds no passwords, no password hashes and no
  `auth.users` rows — by design; it is emailed. Every member and staffer must
  re-register or be re-invited, and each will get a **new** `auth.users` id.
  Everything below keys on `profiles.id`, so restoring against re-registered
  users means re-mapping every id (§5).
- **Uploaded files.** Logos, gallery images, member photos and CAC documents
  live in Supabase Storage. `photo_url` / `avatar_url` / `logo_url` are URLs
  into a bucket the archive does not contain — they will 404 after a restore
  into a new project.
- **Excluded tables.** Saved cards, payout bank accounts, instructor bank
  details, audit logs, notifications and delivery telemetry are never in the
  archive (`EXCLUDED_TABLES`, `lib/backup-plan.ts`). Payout accounts must be
  re-entered and re-verified through Settings → Payouts.
- **`waivers`.** `waiver-signatures.csv` references `waiver_id` values whose
  waiver *documents* are not exported. Load signatures with `waiver_id` null,
  or recreate the waivers first and re-map.
- **Paystack linkage.** Plan codes, subaccount codes and subscription codes are
  columns in the DB but the objects live at Paystack; see `DR_RUNBOOK.md` §5.
- **Anything after the backup ran.** `generated_at` in the manifest is the
  cut-off.

## 3. Columns that are derived, generated, or absent

- **`gym_id` is not in most CSVs.** The export is already scoped to one gym, so
  the column was dropped as redundant. On reload it must be supplied from
  `gym.csv`'s `id` — a literal in every `INSERT`. `expenses.csv`,
  `equipment.csv` and `waiver-signatures.csv` are exported with `*` and do
  carry theirs.
- **`profiles.full_name` and `profiles.member_id` are generated columns** and
  cannot be inserted; they recompute from `first_name`/`last_name` and `id`.
- **`profiles.waiver_signature` is withheld** from `members.csv` (the signature
  blob is in `waiver-signatures.csv`); `waiver_signed_at` is present.
- **jsonb columns** are written as JSON text in the cell and load back as-is.
- **Times are UTC** in every file.
- A cell that begins `=`, `+`, `-` or `@` was written with a leading TAB by the
  formula-injection guard in `lib/csv.ts`. **Strip that leading tab on load**,
  or the value comes back one character longer than it went out.

## 4. Load order

Foreign keys, so this order is not negotiable. Load into a database that
already has the schema (`DR_RUNBOOK.md` §1).

1. `auth.users` — created by re-registration or by Supabase Auth import; not
   from this archive.
2. `profiles` — from the profile columns of `members.csv` and `staff.csv`.
   `profiles.id` must equal the `auth.users` id (§5).
3. `gyms` — from `gym.csv`. Note its `id`; every step below needs it.
4. `membership_plans` — `plans.csv`.
5. `gym_member_links` (`members.csv` link columns), `gym_staff_links`
   (`staff.csv` link columns), `classes`, `business_hours`, `equipment`,
   `expenses`, `waivers` (recreated by hand).
6. `class_schedules` — needs `classes`.
7. `member_subscriptions`, `memberships`, `payments`,
   `instructor_subscriptions` — need `profiles` **and** `membership_plans`.
8. `check_ins`, `class_bookings`, `instructor_sessions`,
   `instructor_payouts`, `waiver_signatures` — need everything above.

Load with triggers suppressed, exactly as in `DR_RUNBOOK.md` §2 — the
membership-sync, payment-status and check-in triggers will otherwise fire on
every replayed row and rewrite the history being restored:

```sql
set session_replication_role = replica;
-- \copy each table here, in the order above
set session_replication_role = origin;
```

Then re-check the invariants the triggers would have maintained: one live row
per member in `member_subscriptions` (`member_subscriptions_one_live_idx` will
refuse a second), and `payments.payment_status` consistent with `status`.

## 5. The id-collision hazard — read before loading anything

Every id in this archive is a UUID that was unique **in the database it came
from**. Three cases, and only the first is easy:

- **Into an empty database** (new project, gym recreated from scratch): ids
  transplant unchanged, and every foreign key in the archive keeps working.
  This is the only case where a straight load is correct.
- **Into a database that still holds this gym** (recovering a deleted table):
  the surviving rows carry the same ids. `insert` raises a primary-key
  violation on the good rows and inserts the rest — which is the *safe*
  outcome. Load into a staging schema first, diff, and copy across only what is
  genuinely missing. Never `on conflict do update` a whole archive over live
  data: the archive is a point in time and will silently roll back every change
  made since.
- **Into a database that holds a DIFFERENT gym** (a second tenant, or a
  re-created gym with a new id): ids do not collide, but nothing lines up
  either. `gym_id` must be rewritten to the target gym everywhere, and
  `profiles.id` must be re-mapped to the new `auth.users` ids — which means
  rewriting `member_id`, `instructor_id` and `user_id` across every table in
  §4 through one mapping table, built once and applied everywhere:

  ```sql
  create table restore_map (old_id uuid primary key, new_id uuid not null);
  -- populate by matching profiles.email; anyone unmatched needs a decision,
  -- not a default.
  ```

  A member whose email does not match anything is not a row to skip quietly:
  their payments and check-ins have nowhere to attach, and dropping them is a
  choice someone has to make deliberately.

**Never load an archive into a live tenant that isn't the one it came from.**
The gym's own `gym_id` is what RLS scopes on; a row loaded with the wrong one
is visible to the wrong gym, and no policy will catch it because the write went
in as service-role.

## 6. Verification after a load

- Row counts per table match `manifest.json` (allowing for anything the
  manifest already flagged as failed or truncated).
- `select count(*) from public.profiles p join public.gym_member_links l on
  l.member_id = p.id where l.gym_id = '<gym>'` — every link resolves to a
  person, no orphans.
- Sign in as one restored member end to end; a member who cannot sign in has
  not been restored, whatever the row counts say (§2).
- The §6 checklist in `DR_RUNBOOK.md` for anything wider than one gym.

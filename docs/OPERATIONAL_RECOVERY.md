# Operational recovery jobs

Payment correctness and tenant backups use database-backed work queues. A
function timeout, deploy, or transient provider outage leaves retryable state in
Postgres instead of relying on a log line or the next provider delivery.

## Payment webhook recovery

`/api/paystack/webhook` verifies Paystack's HMAC over the original request body
and writes a `payment_webhook_jobs` row **before** fulfillment. The row records
`verification_method=paystack_hmac` and `verified_at`; if the durable write or
encryption is unavailable, the endpoint returns 503. It does not acknowledge
mandatory work it cannot preserve.

Original provider payloads are needed to replay `subscription.create` because
it carries Paystack's cancellation token. They are encrypted with the existing
`SECRETS_ENCRYPTION_KEY` via AES-256-GCM (`v1.<iv>.<tag>.<ciphertext>`, random
12-byte IV per row). There is no password KDF or salt in this format because the
configuration value is already a uniformly random 32-byte key. The queue table
is service-role mutation-only; the operator page selects summaries and never
selects ciphertext.

Treat `SECRETS_ENCRYPTION_KEY` as a permanent recovery key. Before a planned
rotation, drain `payment_webhook_jobs` of `queued`, `retry`, and `processing`
rows. If pending work must survive rotation, pause webhook ingress and the
worker, decrypt/re-encrypt the rows under a versioned dual-key migration, verify
one replay in an isolated environment, then remove the old key. Replacing the
key without that migration makes existing queued payloads unreadable; those
jobs fail visibly rather than being guessed from partial data.

`/api/cron/webhook-recovery` claims at most 20 due rows with a ten-minute lease.
Transient failures use exponential backoff capped at six hours. Permanent
failures become `dead`, stay visible at the platform console's **Job health**
page, and create a durable deduplicated incident. A platform administrator with
a current exact-session proof can choose **Verify & retry**. The SQL requeue
function independently checks `private.is_platform_admin()`.

Reconciliation-discovered charges enter the same queue with
`verification_method=paystack_api`. Before any queued `charge.success` is
fulfilled, including an HMAC-ingested replay, the worker rebuilds its data from
Paystack transaction verification and requires provider status `success`. A
stored body or transaction-list response alone cannot grant access.

Platform subscription charges commit their ledger row, immutable original
coverage, current coverage allocation, gym paid-through state, and audit entry
through `settle_platform_charge()`. Reference and gym locks serialize webhook,
callback, and out-of-order charges. Older recovered charges append a full paid
period after later valid access rather than shortening it. Refund evidence that
arrived first is applied inside the same transaction; a fully refunded charge
does not send a receipt or leave future access and opens a mandate-review
incident. Superseded Paystack mandates are retired only after the database
commit. Their old code and retirement outcome remain on the restricted
allocation so a provider failure can be retried without losing the handle.

## Reconciliation checkpoints

`/api/cron/reconcile` is separate from reminder mail. It processes four
provider pages and five local pages per invocation. The pinned `[from,to]`
window, provider page, local table and local UUID cursor live in
`operational_job_state.cursor`. The watermark advances only after every provider
and local page completes. The first deployment begins before Paystack existed,
so no implicit 48-hour bootstrap gap exists; high volume takes more bounded
invocations instead of being cut off after five pages or 1,000 rows.

## Backup capacity

`enqueue_due_gym_backup_jobs()` materializes every due tenant into
`gym_backup_jobs`. `/api/cron/backups` claims the oldest 20 sequentially each
hour. Complete archives leave the queue; failed and partial archives remain and
back off. A timed-out lease becomes claimable after ten minutes. The response
and operator page report queue depth and the oldest due timestamp; an oldest
item overdue by 48 hours opens a durable incident.

## Heartbeats and HTTP status

`operational_job_state` records start, heartbeat, success, watermark, last
error, and consecutive failure count for notifications, backups,
reconciliation, and webhook recovery. Missing service credentials return 503.
Mandatory job failures return 500 so Vercel records a failed invocation. The
platform Job health page is guarded by `requirePlatformAdmin()`, which requires
the current session's privileged proof.

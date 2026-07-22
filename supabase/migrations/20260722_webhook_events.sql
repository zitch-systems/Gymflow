-- Webhook replay ledger.
--
-- Charge events are already replay-safe (UNIQUE paystack_reference), but the
-- status-flip events (subscription.disable / subscription.not_renew /
-- invoice.payment_failed) carry no reference: a captured, correctly-signed
-- body replayed after a gym or member re-subscribes would re-cancel a paying
-- account. A replay is byte-identical by definition, so the route hashes the
-- raw body and skips anything it has already successfully processed.
--
-- Rows are only written AFTER a 200 ack — a 500 (transient failure) leaves no
-- row, so Paystack's own retry of the same body still gets processed.
--
-- Service-role-only: no policies, and all privileges revoked from anon /
-- authenticated (same posture as rate_limits). Cron GCs rows older than 30
-- days — far beyond Paystack's retry window.

create table if not exists public.webhook_events (
  body_hash text primary key,          -- sha256 hex of "<provider>:<raw body>"
  event_name text,                     -- e.g. 'subscription.disable' (ops visibility)
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
-- Explicit rather than relying on default privileges: the webhook route and
-- cron GC are the only writers, both service-role.
grant all on public.webhook_events to service_role;

create index if not exists idx_webhook_events_received_at
  on public.webhook_events (received_at);

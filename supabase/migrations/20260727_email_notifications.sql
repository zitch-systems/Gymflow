-- Branded transactional email: the fourth staff switch, the Resend delivery
-- ledger, and the suppression list.
--
-- 1. gyms.notif_membership_updates — the switch for membership STATE changes
--    (paused, resumed, freeze approved/rejected). Deliberately NOT folded into
--    notif_renewal_nudges: a nudge is us asking a member for money before an
--    expiry, and a gym that finds that pushy switches it off. A state change is
--    the gym's own action landing on someone's account — mute it along with the
--    nudges and members find out their card stopped opening the door by walking
--    into a locked turnstile. Fourth entry in Settings → Notifications, beside
--    class reminders / renewal nudges / payment receipts.
--
-- 2. email_events — the Resend delivery ledger. Every callback Resend sends
--    (email.sent / delivered / bounced / complained / …) lands here, keyed on
--    Resend's own event id so a webhook replay is a plain no-op rather than a
--    duplicate row. Without it "the member says the receipt never arrived" is an
--    argument; with it, it's a lookup.
--
-- 3. email_suppressions — addresses we must stop mailing, written by the webhook
--    on a hard bounce or a spam complaint. Sending reputation attaches to the
--    DOMAIN, and every gym on the platform shares ours: one gym's stale CSV
--    import of dead addresses, mailed forever, is what lands another gym's
--    password-reset mail in spam.
--
-- email_events is append-only ops telemetry and grows with send volume; nothing
-- reads rows older than a release cycle. Its retention GC belongs in the
-- existing /api/cron sweep next to the rate_limits and webhook_events deletes,
-- NOT here. Suppressions are permanent by contrast — an address that hard
-- bounced stays dead until a human clears it.
--
-- Both tables are service-role-only (RLS on, no policies, privileges revoked
-- from anon/authenticated), same posture as webhook_events and rate_limits: the
-- webhook route and cron are the only readers and writers, and a suppression
-- list is a list of real people's addresses.
--
-- Idempotent. Safe to re-run.

-- 1. Membership-state switch.
alter table public.gyms
  add column if not exists notif_membership_updates boolean not null default true;

comment on column public.gyms.notif_membership_updates is 'Staff switch for membership state-change email (paused, resumed, freeze decisions). Separate from notif_renewal_nudges: a nudge asks the member for money, this reports something the gym already did to their account.';

-- 2. Resend delivery ledger.
create table if not exists public.email_events (
  event_id text primary key,           -- Resend's own event id; makes a replay a no-op
  email_id text,                       -- Resend message id, ties every event for one send together
  type text,                           -- 'email.sent' | 'email.delivered' | 'email.bounced' | ...
  recipient text,
  subject text,
  template text,                       -- our tag, e.g. 'member_receipt' — which template misbehaves
  gym_id uuid references public.gyms(id) on delete set null,
  payload jsonb,                       -- full event body: bounce sub-type, SMTP diagnostics
  created_at timestamptz not null default now()
);

comment on column public.email_events.event_id is 'Resend event id. Primary key so a webhook redelivery upserts over itself instead of inflating the ledger.';
comment on column public.email_events.gym_id is 'Gym the message was sent on behalf of, when known. ON DELETE SET NULL: deleting a gym must not erase the delivery history that explains a reputation dip.';

alter table public.email_events enable row level security;
revoke all on public.email_events from anon, authenticated;
-- Explicit rather than relying on default privileges: delivery events name real
-- recipients, and only the webhook route and cron GC touch them.
grant all on public.email_events to service_role;

create index if not exists idx_email_events_recipient
  on public.email_events (recipient);

create index if not exists idx_email_events_type_created
  on public.email_events (type, created_at);

create index if not exists idx_email_events_gym_created
  on public.email_events (gym_id, created_at);

-- 3. Suppression list.
create table if not exists public.email_suppressions (
  address text primary key,            -- stored lowercased; the writer normalises
  reason text not null,                -- 'bounced' | 'complained'
  detail text,                         -- bounce sub-type or provider diagnostic, for appeals
  created_at timestamptz not null default now()
);

comment on column public.email_suppressions.address is 'Lowercased recipient address we must stop mailing. Lowercasing is the writer''s job — an address suppressed in one case must not be mailable in another.';
comment on column public.email_suppressions.reason is 'Why we stopped: ''bounced'' (address is dead) or ''complained'' (recipient marked us as spam). Not a CHECK — a new Resend event class must never make the webhook fail to record a complaint.';

alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from anon, authenticated;
grant all on public.email_suppressions to service_role;

# Email — branded transactional mail on Resend + Supabase

Everything GymFlow sends by email, how it's branded, and the one-time
dashboard steps that can't be done from code (DNS verification, the Supabase
auth hook, the Resend delivery webhook).

The whole system **fails open**: with no `RESEND_API_KEY` set, every send is
silently skipped and nothing else breaks. You can merge and deploy this before
any DNS is verified — mail simply starts flowing once the keys and records are
in place.

---

## 1. The two senders

| | Platform sender | Gym sender |
|---|---|---|
| From | `GymFlow <noreply@gymflow.ng>` | `Iron Republic <iron-republic@gymflow.ng>` |
| Who's speaking | GymFlow | the gym, to its own member |
| Branding | GymFlow logo + emerald | gym's `logo_url` + `brand_color`, GymFlow in the footer |
| Reply-To | `support@gymflow.ng` | the gym's own `gyms.email` |
| Used for | owner/staff/instructor/admin mail: billing, credentials, payouts, security | member mail: welcome, receipts, reminders, bookings, freezes |

**Why the gym sender is a display name, not a real gym domain.** Resend
verifies *domains*, not mailboxes. A gym can't send from `@ironrepublic.com`
unless that domain is verified in our Resend account (a per-gym onboarding
project we haven't built). What we *can* do on one verified domain is give each
gym its own local part + display name + reply-to + logo + colour, so a member
sees their gym in the inbox and replies reach the gym. The GymFlow lockup stays
in the footer so an unfamiliar sending domain reads as legitimate, not phish.

`EMAIL_TENANT_DOMAIN` lets gym mail move to a dedicated verified subdomain
(e.g. `gyms.gymflow.ng`) later, so one gym's spam complaints can't drag down
deliverability of our password-reset mail. Until set, both senders share the
root domain.

---

## 2. What gets sent

Gym-branded, to members (`lib/email/templates/member.ts`). Gated by the gym's
Settings → Notifications switches except where marked **critical** (always
sent — a member must hear these even if the gym muted the marketing-ish ones):

| Template | When | Gate |
|---|---|---|
| welcome | member added by staff, self-join, or app signup | critical |
| renewalReminder | 7/3/1 days before expiry (cron) | renewal nudges |
| receipt | Paystack, cash, or transfer payment recorded | payment receipts |
| paymentFailed | auto-renew charge failed | critical |
| membershipExpired | membership lapsed | renewal nudges |
| membershipPaused / membershipResumed | staff paused/reactivated | membership updates |
| freezeStarted / Approved / Denied / Resumed | freeze lifecycle | membership updates |
| classBooked / Waitlisted / Promoted / Cancelled | booking events | class reminders |
| classesToday | morning digest of today's booked classes (cron) | class reminders |
| autoRenewEnabled / Disabled / Ended | recurring-billing changes | receipts / critical |

GymFlow-branded, to owners/staff/instructors/admins
(`lib/email/templates/platform.ts`) — all ungated (contractual: money, access,
security): owner welcome & provisioning, staff invite / password reset / access
& role changes, platform subscription receipt / past-due / cancelled, trial
ending / ended, payout requested / sent / completed / failed / rejected, payout
& instructor-bank change security alerts, payout-account review, freeze
requested, commission changed, contact-form received + ack, underpayment alert.

Auth mail (`lib/email/templates/auth.ts`) — signup confirm, password recovery,
invite, magic link, email change, reauthentication — rendered by the Supabase
hook (§5). Members get their gym's branding; owners get GymFlow's.

Every send is one call to `sendGymEmail` / `sendPlatformEmail`
(`lib/email/send.ts`), the single choke point that applies gating, the
suppression list, branding, and the From line. Templates are pure functions of
their inputs and never decide whether to send.

---

## 3. Resend — domain (required to send anything)

The sending domain is created; DNS must be added at the registrar before Resend
will verify it. Records for **gymflow.ng** (region `eu-west-1`):

| Type | Name | Value |
|---|---|---|
| TXT (DKIM) | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC6/8/v1Yd0ozvfKhLqtKxKv+LsvDKafQFgUnGh5rbMwqvYH59ajJ6iwRcbtmSvMHZCxwoXbxUor+i6sHhv+8uKJe6qwRtMWvfDfp99pEjC7L+GJdPxmWnp63a/GLHpSWqmAXhcxgfEbro+eXvxIzFsL1KoBT5kb2ukTrFWTixf0QIDAQAB` |
| MX (SPF) | `send` | `feedback-smtp.eu-west-1.amazonses.com` (priority 10) |
| TXT (SPF) | `send` | `v=spf1 include:amazonses.com ~all` |

After the records propagate, verify in the Resend dashboard (or re-run
verification). A `DMARC` record (`_dmarc` → `v=DMARC1; p=none; rua=mailto:dmarc@gymflow.ng`)
is recommended before volume ramps.

> Resend's current plan allows **one** domain. A separate verified
> `EMAIL_TENANT_DOMAIN` for gym mail needs a plan upgrade; until then both
> senders use `gymflow.ng`, which is correct and safe — just shared-reputation.

Then set in the app environment:

```
RESEND_API_KEY=re_...
RESEND_FROM=GymFlow <noreply@gymflow.ng>
```

## 4. Resend — delivery webhook (bounces & complaints)

Reputation attaches to the domain, and every gym shares ours — so a hard bounce
or spam complaint must stop us mailing that address. The webhook records every
delivery event to `email_events` and auto-suppresses bad addresses in
`email_suppressions`; `sendGymEmail` / `sendPlatformEmail` check that list
before every send.

1. Resend → Webhooks → add endpoint → `https://gymflow.ng/api/resend/webhook`.
2. Subscribe to at least `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained` (add `delivery_delayed`, `opened`, `clicked` if wanted).
3. Copy the signing secret and set `RESEND_WEBHOOK_SECRET=whsec_...`.

Unset secret → the route returns `501` and records nothing (feature off).
Bad signature → `401`. The endpoint verifies the Standard Webhooks (Svix)
signature with a 5-minute replay window (`lib/webhook-verify.ts`).

## 5. Supabase — branded auth mail (the Send Email hook)

By default Supabase sends its own plain auth mail, rate-limited to a handful per
hour without custom SMTP. The hook routes that mail through our branded
templates and Resend instead.

1. Supabase → Authentication → Emails → Hooks → **Send email** → enable.
2. URL: `https://gymflow.ng/api/auth/email-hook`.
3. Copy the generated secret → set `SUPABASE_AUTH_HOOK_SECRET=v1,whsec_...`
   (Supabase shows it with the `v1,` prefix; store it as shown).
4. Confirm the Supabase project **Site URL** is `https://gymflow.ng` and the
   redirect allow-list includes `https://gymflow.ng/**` and `https://*.gymflow.ng/**`
   (gym subdomains) — the hook builds links against it.

Unset secret → the hook returns `501` and Supabase falls back to its own
templates, so enabling this is safe and reversible. Unlike the rest of the
system it fails **loud** (non-2xx) when it can't deliver: for auth mail, the
message *is* the flow — a silent skip would strand someone with no reset link.

## 6. Local & preview

No `RESEND_API_KEY` → all sends skip, `sendEmail` returns `{ ok:false,
skipped:true }`, nothing breaks. To preview a template render without sending,
call it and pass the result through `renderEmail` (`lib/email/layout.ts`); the
vitest suite (`test/email-layout.test.ts`) does exactly this and asserts on the
HTML/text. There's no dashboard for drafts — the templates in code are the
source of truth.

## 7. Retention

`email_events` is append-only ops telemetry; the daily `/api/cron` sweep deletes
rows older than 90 days. `email_suppressions` is permanent — a hard-bounced
address stays suppressed until a human removes the row (e.g. after the member
fixes their mailbox and asks to be re-enabled).

## 8. Where things live

```
lib/email/
  index.ts        transport: sendEmail(), gymFromAddress(), platformAlertRecipients()
  send.ts         choke point: sendGymEmail(), sendPlatformEmail() — gating + suppression + branding
  brand.ts        palette, EmailBrand, gymBrand()/platformBrand(), safeHex(), gymUrl()
  layout.ts       table-based shell + block vocabulary (p, h1, panel, button, callout, code…)
  columns.ts      GYM_EMAIL_COLUMNS + EmailGym/EmailContact types (pure, test-importable)
  recipients.ts   service-role lookups: getEmailGym, getContact(s), getGymOwnerEmails, isSuppressed
  auth-hook.ts    Supabase auth-hook payload → branded EmailContent
  templates/      member.ts · platform.ts · auth.ts — pure (subject, preheader, blocks)
app/api/auth/email-hook/route.ts   Supabase Send Email hook receiver
app/api/resend/webhook/route.ts    Resend delivery webhook → email_events + suppressions
supabase/migrations/20260727_email_notifications.sql
```

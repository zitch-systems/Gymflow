# GymFlow — Go-live checklist

Everything required to run this app in production. Items marked ☐ are one-time
manual steps in external dashboards; everything else ships with the repo.

## 1 ☐ Environment variables (Vercel → Settings → Environment Variables)

Set each for **Production AND Preview** (previews don't inherit production):

| Variable | Where to get it | Powers |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | everything |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page | everything |
| `SUPABASE_SERVICE_ROLE_KEY` | same page (service_role secret) | signup provisioning, join links, Paystack fulfillment, cron reminders, audit log, contact form |
| `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys | checkout init/verify, webhook signature |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | same page | (reserved for inline checkout) |
| `NEXT_PUBLIC_SITE_URL` | your real production URL (e.g. `https://gymflow.ng`) | Paystack return URL, email links — **wrong value breaks post-payment redirects** |
| `CRON_SECRET` | `openssl rand -hex 32` | authorizes `/api/cron` |

After changing env vars: **Deployments → ⋯ → Redeploy** (they don't apply to existing builds).

## 2 ☐ Database migrations (Supabase → SQL Editor)

Run each file from `supabase/migrations/` in order — all idempotent, safe to re-run:

1. `20260609_payments_paystack_reference_unique.sql` — **payment idempotency** (prevents double-fulfillment of a Paystack charge; the code's 23505 guard depends on it)
2. `20260609_self_service_policies.sql` — RLS for inbox mark-all-read, coach bank form, reminder logs
3. `20260610_profiles_availability.sql` — coach availability column

Until applied, the affected features fail with clear messages; nothing else breaks.

## 3 ☐ Paystack dashboard

- **Webhook URL** (Settings → API Keys & Webhooks): `https://<your-domain>/api/paystack/webhook`
  (HMAC-verified; idempotent; safe to point test + live modes at it)
- Test a renewal with the test card `4084 0840 8408 4081` (any future expiry/CVV, OTP `123456`),
  then confirm: one `payments` row, `member_subscriptions.end_date` advanced, receipt notification in the member inbox.

## 4 ☐ Keep-warm (free-tier Supabase pauses; Hobby cron is daily-only)

`vercel.json` runs `/api/cron` daily at 08:00 UTC (reminders + keep-warm). A
paused free-tier Supabase project takes seconds to resume, which feels like a
hung first page-load. For all-day warmth, point any uptime pinger
(UptimeRobot/BetterStack, free tiers) at:

```
https://<your-domain>/api/cron?secret=<CRON_SECRET>
```

every 5–10 minutes — or upgrade the Supabase project so it never pauses.

## 5 ☐ One production host

This repo currently auto-deploys to **both** Vercel and Cloudflare Pages.
Vercel is the production target (functions pinned to `dub1` next to the
database in `eu-west-1`; crons configured). Treat the Cloudflare Pages project
as staging or disconnect it — two "productions" with different env vars is how
config drift happens.

## 6 ☐ Strongly recommended: refresh the generated DB types

The live schema has drifted from `lib/database.types.ts` (check constraints and
generated columns bit us three times in production — `gyms_status_check`,
`profiles.full_name GENERATED`). Regenerate so this class of bug fails in CI:

```bash
npx supabase gen types typescript --project-id kdbbrxqxqewbjoozmfhq > lib/database.types.ts
```

## Verification battery (run before any deploy)

```bash
npm run lint        # eslint, zero findings expected
npx tsc --noEmit    # types
npm run build       # 42 routes
```

## Post-deploy smoke test (5 minutes)

1. `/signup` → create a gym → should land signed-in on `/admin` (one step, no email).
2. `/admin/members` → "Invite link" → open in a private window → join as a member → lands on `/dashboard`.
3. Member: check in, book a class, renew with the Paystack test card.
4. Confirm an instructor account is routed to `/coach` and **cannot** open `/admin`.
5. Superadmin `/superadmin/audit` shows entries after the actions above.

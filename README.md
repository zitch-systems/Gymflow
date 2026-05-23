# GymFlow

Modern gym management SaaS for Nigerian fitness businesses, built on **Next.js 16** + **Supabase** + **Paystack**.

Multi-tenant by subdomain (`powerhouse.gymflow.ng`, `lekki-fit.gymflow.ng`, …). Each gym gets member management, QR check-in, class scheduling, automated reminders, Paystack subscriptions, and analytics — all installable as a PWA.

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack, React 19.2)
- **Auth & DB:** Supabase (Postgres + RLS + `@supabase/ssr`)
- **Payments:** Paystack (inline checkout + signature-verified webhook)
- **Styling:** Tailwind v4 + custom `gf-*` design system (preserved from v1)
- **PWA:** Service worker, offline shell, install prompts
- **Hosting:** Vercel

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then fill in Supabase URL, anon key, Paystack keys
npm run dev                         # http://localhost:3000
```

> **Note:** Next.js 16 ships Turbopack by default. Don't pass `--turbopack`. Don't try `next lint` either — it's removed; use ESLint CLI directly. If you see "Both middleware and proxy detected", delete `middleware.ts` — Next 16 renamed the convention to `proxy.ts`.

On localhost the subdomain rewrite uses the slug `demo-gym`, so you need a `gyms` row with `slug = 'demo-gym'` in Supabase for protected routes to resolve.

## Environment variables

| Variable | Where to get it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Paystack dashboard (`pk_test_…` / `pk_live_…`) |
| `PAYSTACK_SECRET_KEY` | Paystack dashboard (`sk_test_…` / `sk_live_…`) — server only |
| `NEXT_PUBLIC_SITE_URL` | Public origin used for QR/check-in URLs (e.g. `https://gymflow.ng`) |

## Routes

### Public

- `/` — marketing landing
- `/login` — sign-in (server action, role-based redirect)
- `/join` — member signup (NOK + waiver + profile + gym link in one action)
- `/offline` — PWA offline shell

### Member (auth required)

- `/dashboard` — subscription status + profile + quick actions
- `/dashboard/renew` — pick a plan, pay via Paystack inline
- `/checkin` — self check-in
- `/classes` — weekly schedule + book

### Admin (gym staff: owner / manager / front_desk / accountant)

- `/admin/dashboard` — KPIs (members, today's check-ins, expiring soon, revenue)
- `/admin/members` — searchable members table
- `/admin/pricing` — plan CRUD
- `/admin/classes` — class + schedule CRUD
- `/admin/staff-checkin` — manual check-in form + today's visits
- `/admin/analytics` — KPIs + 7-day check-in chart + revenue
- `/admin/business-hours` — open/close per day
- `/admin/operations` — equipment + expenses
- `/admin/reminders` — expiring-this-week + reminder logs
- `/admin/waiver` — versioned waiver editor + signature list

### Other roles

- `/instructor` — instructor portal (own schedule)
- `/superadmin` — platform admin (all gyms, platform revenue)

### API

- `POST /api/paystack/initiate` — start a transaction
- `POST /api/paystack/verify` — verify a reference + create membership/payment/saved_card
- `POST /api/paystack/webhook` — Paystack webhook (signature-verified)

## Architecture

- `proxy.ts` rewrites subdomain → `/gym/[slug]/…`. Localhost and the apex domain leave platform routes (`/`, `/instructor`, `/superadmin`) alone.
- `lib/supabase/{client,server}.ts` — typed `@supabase/ssr` clients (uses `lib/database.types.ts` from `supabase gen types`).
- `lib/auth/dal.ts` — Data Access Layer with React `cache()` memoization (`getSessionUser`, `getProfile`, `requireAuth`, `roleHome`).
- `lib/auth/gym.ts` — gym-scoped variants (`getGymBySlug`, `requireMember`, `requireStaff`, `getStaffRole`).
- `lib/auth/actions.ts` — sign-in/up/out, password reset.
- `lib/actions/{checkin,plans,classes,business-hours,waiver}.ts` — domain server actions.
- `app/globals.css` — Tailwind v4 + full legacy `gymflow.css` + `gymflow-extra.css` (4200+ lines of `gf-*` design system) + a ~500-line port supplement for layouts introduced in the React port.
- `public/{manifest.json, sw.js}` — PWA shell.

## Supabase setup

Before signups work you must enable email signups in the Supabase dashboard:

1. **Authentication → Providers → Email**
2. Enable email provider ✓
3. Enable signups ✓
4. Disable "Confirm email" for testing (re-enable for production)

Without this, `auth.signUp()` returns **401 Unauthorized**.

## Contact

41 Ogudu Road, Lagos · 08166938327 · hello@gymflow.ng

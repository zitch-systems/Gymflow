# GymFlow — Platform Audit & Optimization Report

**Date:** 2026-06-28 · **Branch:** `claude/platform-audit-optimization-oy23o5`
**Scope:** full-stack audit (functional, security, performance, DB, SEO, a11y, code quality, architecture) of the GymFlow gym-management SaaS, plus the fixes applied in this PR.

---

## 1. Executive Summary

**Overall health: Strong (B+).** GymFlow is a mature, unusually disciplined codebase: a clean Next.js 16 / React 19 (App Router, RSC + Server Actions) frontend, Supabase (Postgres + RLS) backend, Paystack billing (member→gym + platform SaaS), multi-tenant by subdomain. `tsc`, `eslint` and `next build` are all green. Prior audit rounds already hardened the webhook (HMAC + idempotency), RLS self-service policies, and redirect/IDOR surfaces.

The audit found **no remotely-exploitable critical vulnerability**, but did surface a small number of **real privilege/data-integrity issues** and a meaningful backlog of **SEO, accessibility, and performance** gaps. The highest-impact items have been fixed in this PR.

### Health scores
| Area | Score | Notes |
|---|---|---|
| Security | 82/100 | Disciplined; two service-role overwrite paths fixed |
| Correctness (bugs) | 78/100 | Booking race + timezone day-boundary bugs fixed |
| Performance / DB | 70/100 | N+1 reminders fixed; index migration added |
| SEO | 58 → ~85/100 | Canonicals, noindex, JSON-LD, metadata added |
| Accessibility (WCAG 2.2) | 68 → ~80/100 | Landmarks, skip link, contrast, keyboard fixes |
| Code quality | 85/100 | Clean, well-commented, consistent patterns |

### Critical/High items — status
1. **Staff-invite & gym-onboard could overwrite an existing user's profile (role/gym)** via service-role — *FIXED*.
2. **Class booking over-capacity race** (check-then-insert) — *FIXED* (DB trigger migration).
3. **Subscription duration trusted from charge metadata** (pay-little-get-much) — *FIXED*.
4. **Timezone day-boundary bugs** (booking date, check-in dedup off-by-one in WAT) — *FIXED*.
5. **No `noindex` on gated surfaces; subdomain/apex duplicate content; zero structured data** — *FIXED*.

---

## 2. Architecture Overview (Phase 1)

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind v4.
- **Rendering:** RSC for data pages; Server Actions for all mutations; middleware for session refresh + subdomain rewrite.
- **Backend/DB:** Supabase (Postgres, RLS, Storage, Auth). Three client tiers: anon (`lib/supabase/client.ts`), request-scoped session (`server.ts`), and service-role (`admin.ts`, `server-only`).
- **Auth/Z:** `lib/auth/dal.ts` role gates (`requireMember/requireStaff/requireInstructor/requirePlatformAdmin`), all `cache()`-wrapped; RLS is the authority on writes.
- **Multi-tenancy:** `<slug>.gymflow.ng` → rewritten to `/g/[slug]`; staff gym resolved from `gym_staff_links` + an active-gym cookie.
- **Billing:** Paystack — member charges (`lib/paystack-fulfill.ts`) and platform SaaS subscriptions (`lib/platform-fulfill.ts`); webhook `app/api/paystack/webhook/route.ts`; cron `app/api/cron/route.ts`.
- **Surfaces:** Marketing (8), Auth (4), Member PWA, Admin, Instructor, Superadmin consoles.
- **Deploy:** Vercel (`vercel.json`), Vercel Cron, security headers + HSTS in `next.config.ts`.

> **Architecture risk (documented, not code-fixable here):** the **base schema + core RLS policies are not in version control** — only incremental migrations are. A DR/staging rebuild from this repo would come up with RLS effectively off on the core tables. **Recommendation:** check in a `supabase db dump` baseline and add a CI `db diff` gate. This is the single most important follow-up.

---

## 3. Security Report (Phase 4)

### Fixed in this PR
| # | Sev | Issue | File | Fix |
|---|---|---|---|---|
| S1 | High | `inviteStaff` overwrote an existing user's `profiles.role`/`gym_id` via service-role → role-downgrade / tenant-repoint of any user by email | `lib/actions/admin-staff.ts` | Only mint a profile for brand-new accounts; never rewrite an existing one; reject emails already bound to another gym. Access is granted by the staff link, not the profile. |
| S2 | High | `provisionGym` same overwrite footgun on the platform path | `lib/actions/onboard.ts` | Look up existing profile first; link-only for existing users; reject cross-gym reuse. |
| S3 | Medium | `extendSubscription` read `membership_plans` by id with no `gym_id` scope → foreign-plan duration leak | `lib/actions/admin-member.ts` | Scope the plan lookup to the caller's gym; reject foreign plans. |
| S4 | Medium | `fulfillCharge` trusted `duration_months` from charge metadata (member could pay ₦100, claim 36 months) | `lib/paystack-fulfill.ts` | When the metadata names a real plan in the gym, derive duration from the **DB plan** (authoritative); metadata only as fallback. |
| S5 | Medium | `CRON_SECRET` / webpack signature compared with `!==` (timing) | `app/api/cron/route.ts`, `app/api/paystack/webhook/route.ts` | Constant-time compare (`timingSafeEqual`). |

### Verified safe (no action)
HMAC webhook verification, idempotency (unique reference + 23505 catch + compensating delete), callback reference→user binding, duration clamping, open-redirect guard in `setActiveGym`, UUID validation before `.or()` interpolation, service-role import surface (all `server-only`/trusted), no `dangerouslySetInnerHTML` on user input, `NEXT_PUBLIC_*` exposure is all legitimately public.

### Open recommendations (not in this PR)
- Check in the **baseline schema + RLS policies** (see Architecture risk) — **P0**.
- Rate-limit public/abuse-prone actions: `submitContact` (honeypot only), `verifyBankAccount` (name enumeration), `signUp` (auto-confirm).
- Add a strict CSP with nonces (currently deferred due to inline styles).

---

## 4. Bug Report (Phase 3)

### Fixed in this PR
| # | Sev | Bug | File | Fix |
|---|---|---|---|---|
| B1 | Critical | Class booking capacity is a check-then-insert race → over-booking | `supabase/migrations/20260628_enforce_class_capacity.sql` | BEFORE trigger serializes per (schedule, date) with an advisory lock, recounts, demotes over-capacity rows to `waitlisted`. |
| B2 | High | Manual payment reference `MANUAL-<ms>` collides within a millisecond → payment dropped by unique index | `lib/actions/admin-member.ts` | Append a UUID to the reference. |
| B3 | High | Booking date computed from local weekday but serialized as UTC date → off-by-one in WAT | `lib/actions/booking.ts` | Compute the date in WAT (`watNow()` + `getUTC*`). |
| B4 | High | Manual `extendSubscription` lacked the `status='active'` filter the webhook path uses → could reactivate a later-dated cancelled sub | `lib/actions/admin-member.ts` | Filter to active subs, matching the Paystack path. |
| B5 | Medium | Self check-in "today" + dedup window used UTC day boundary → wrong day 00:00–01:00 WAT | `lib/actions/checkin.ts`, `lib/format.ts` | Added WAT date helpers; anchor the day to WAT. |
| B6 | Medium | `manualCheckIn` (front desk) didn't dedup same-day check-ins (self path did) → inflated visit counts | `lib/actions/admin-member.ts` | Mirror the same-day dedup. |
| B7 | Low | `splitTime` rendered `NaN:00 PM` on a malformed `start_time` | `app/(admin)/admin/classes/page.tsx` | NaN guard. |

### Open recommendations (not in this PR)
- Admin **revenue 7-day chart** and **member week grid** have the same UTC-vs-local day-key drift (display-only) — `app/(admin)/admin/dashboard/page.tsx`, `app/(member)/dashboard/page.tsx`. Use the new WAT helpers.
- Analytics header says "30 days" over a 42-day chart — `app/(admin)/admin/analytics/page.tsx`.
- Logo/avatar/equipment uploads orphan old storage objects (cost) — `lib/actions/{gym,instructor,facility}.ts`; revoke the `URL.createObjectURL` preview in `components/admin/equipment-form.tsx`.

---

## 5. Performance Report (Phase 5)

### Fixed in this PR
- **Cron renewal reminders N+1** (`app/api/cron/route.ts`): was 1 + 2N round-trips (a dedup SELECT + INSERT per subscription) that could exceed the 60s budget → **one batched dedup query + one bulk insert**.
- **Database indexes** (`supabase/migrations/20260628_performance_indexes.sql`): idempotent `CREATE INDEX IF NOT EXISTS` for every hot multi-tenant filter/sort path — notably `gym_staff_links(user_id, is_active)` (hit on **every** authenticated request), plus subscriptions, payments, check-ins, bookings, notifications, audit. *Verify against the live DB before applying — base schema lives outside the repo.*
- **Image pipeline** (`next.config.ts`): AVIF/WebP formats + Supabase `remotePatterns` so per-gym images can be optimized.
- **Repo weight:** removed 38 MB of unreferenced root JPGs.

### Open recommendations (not in this PR)
- Same N+1 in `lib/actions/reminders.ts` (`remindAllDue` loop) — apply the same batching.
- Narrow `select('*')` on `payments`/`check_ins`/`profiles` (member detail + DAL).
- Real pagination on lists that currently truncate at 200/1000 — KPI counts derived from a truncated set are wrong past the cap (`admin/members`, `staff-checkin` search).
- Convert remaining raw `<img>` (gym hero/logo, dashboards) to `next/image` now that `remotePatterns` is configured; add `priority` to the gym hero (LCP).

---

## 6. SEO Report (Phase 6)

### Fixed in this PR (score 58 → ~85)
- **`metadataBase`** now reads `NEXT_PUBLIC_SITE_URL` (was hardcoded → wrong OG/canonical on staging).
- **Home page** got an explicit `metadata` + self-canonical (previously none).
- **Gym landing** `generateMetadata`: canonical pointing at the **subdomain** (resolves the subdomain/apex duplicate-content collision), per-gym OG + Twitter card, `noindex` on not-found.
- **Structured data (JSON-LD):** `Organization` (root layout), `HealthClub` with address/hours/contact (gym landing) — previously zero schema.org anywhere.
- **Gated surfaces** (`admin/member/coach/superadmin` layouts) now emit `robots: noindex,nofollow` (defense-in-depth over the advisory robots.txt).
- **robots.txt**: also disallow `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/billing`, `/offline`.
- **sitemap.xml**: added `lastModified`.

### Open recommendations (not in this PR)
- Per-page `alternates.canonical` + per-page OG on the 7 remaining marketing pages.
- `Product`/`Offer` JSON-LD on `/pricing` and `FAQPage`/`BreadcrumbList` (left out to avoid hardcoding prices that may drift — wire from the real plan data).
- Dynamic per-tenant sitemap entries for gym subdomains.
- 308 redirect apex `/g/<slug>` → subdomain.

---

## 7. Accessibility Report (Phase 7, WCAG 2.2)

### Fixed in this PR (score 68 → ~80)
- **Skip-to-content link** (2.4.1) in the root layout + CSS, targeting new **`<main id="main-content">` landmarks** (1.3.1, 2.4.1) added to the member PWA, all three console shells, and the marketing home.
- **Keyboard-broken settings tab** (2.1.1): the `<a role="button">` with no key handler is now a real `<button>` with `aria-current` (CSS updated to match).
- **Color contrast** (1.4.3): `--gf-text-muted` raised in both themes from ~3.2–3.8:1 (failing) to ~4.6–5:1 — it labels form hints, KPI labels and table headers everywhere.
- **`aria-current="page"`** on the active marketing nav link (4.1.2).

### Open recommendations (not in this PR)
- Announce dynamic status with `role="status"`/`role="alert"` (check-in success/error, form errors) — 4.1.3 (broad, many files).
- QR-scanner modal: focus trap + Escape + focus restore — 2.1.2/2.4.3.
- `<main>` landmarks on the remaining 7 marketing pages.
- Light-theme `--gf-brand`/`--gf-accent` and primary-button text still fail contrast — needs gradient/rgb coordination + visual review.
- Tie form errors to fields (`aria-describedby`/`aria-invalid`); complete or simplify the login tab ARIA pattern.

---

## 8. Code Quality & Architecture (Phases 8–9)

**Strengths:** consistent Server Action shape (`{ ok, error }`), thorough inline rationale comments, `cache()` discipline in the DAL, idempotent money paths, division-by-zero guards in analytics, stable list keys, correct effect cleanup (camera/RAF/observers), reduced-motion handled at both JS and CSS layers (exemplary).

**Short-term:** check in the schema/RLS baseline + CI diff gate; apply the two new migrations; finish the perf/SEO/a11y backlogs above.
**Medium-term:** rate limiting (Upstash) on public actions; storage-object cleanup on re-upload; real cursor pagination + DB-side counts; CSP with nonces.
**Long-term:** extract a shared date/timezone module and route all day math through it; consider read-model caching (`unstable_cache` keyed by gym) for shared gym-scoped reads; observability (the codebase references PostHog/Sentry).

---

## 9. Verification

`npx tsc --noEmit`, `npx eslint .`, and `next build` all pass after the changes. The two SQL migrations are idempotent and must be applied to the Supabase project (and verified against existing indexes) to take effect.

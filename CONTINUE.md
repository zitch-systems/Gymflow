# GymFlow rebuild — progress & continuation

Building the project from scratch from the design bundle (`design/`), exactly
as the `revamp/*.html` prototypes specify. Tracking what's done and the recipe
for what's left.

> **✅ VISUAL REBUILD COMPLETE.** All 6 surfaces (48 routes) are built from
> `revamp/*.html`, building + prerendering, tsc/lint clean. Pages use the
> prototypes' static data. **Next track: backend** — wire Supabase (auth +
> RLS + multi-tenant subdomains) and Paystack so the static UIs become a real
> product. See `design/HANDOFF.md` §5 for the module list. `typedRoutes` is
> enabled in `next.config.ts` (all linked routes exist).

## Surfaces — all ✅ built (static data)

| Surface | Routes | Group |
|---|---|---|
| Marketing | 8 | `app/(platform-pages)` (top-level) |
| Auth | 4 | `/login` `/signup` `/forgot-password` `/reset-password` |
| Member PWA | 8 | `app/(member)` · `.ds-member` |
| Admin | 11 | `app/(admin)` · `.ds-admin` |
| Instructor | 7 | `app/(coach)` · `.ds-admin` |
| Superadmin | 8 | `app/(superadmin)` · `.ds-admin` |

### Backend track (in progress)
Connected to the live **Gymflow** Supabase project (`kdbbrxqxqewbjoozmfhq`,
full 33-table schema + RLS already present). Done:
- `lib/supabase/{server,client,admin,middleware}.ts`, `middleware.ts` (session refresh)
- `lib/database.types.ts` (generated), `lib/auth/dal.ts` (gates), `lib/auth/actions.ts`, `lib/format.ts`
- **Auth wired + working:** login/signup/forgot/reset + all sign-outs.
- **Member surface gated** (requireAuth in `(member)/layout`) + **data-wired:**
  `/dashboard` (status/checkins/unread), `/dashboard/inbox`, `/dashboard/profile`.
- `.env.local` has the real URL + anon key (gitignored); `.env.example` tracked.

**All four surfaces are gated** (member/admin/coach/superadmin layouts call
the role gates). **Demo logins** (password `Gymflow2026!`): member@ifitness.com
→ /dashboard · admin@ifitness.com → /admin · instructor@ifitness.com → /coach ·
admin@gymflow.ng → /superadmin. Each lands on a **real, data-backed** screen.

Data-wired: **ALL surfaces complete** — Auth ✓ · Member 8/8 ✓ · Admin 11/11 ✓ ·
Coach 7/7 ✓ · Superadmin 8/8 ✓. Real writes: member check-in, coach attendance
(mark sessions), coach profile update, support_tickets.

### Activate with env keys (the only remaining functional gap)
Everything is wired; these paths run once the keys are in env (Vercel + the
web-session env), and no-op/guard cleanly without them:
- `SUPABASE_SERVICE_ROLE_KEY` → Paystack webhook writes (payments + subscription
  extension) and superadmin **onboard** owner-account provisioning.
- `PAYSTACK_SECRET_KEY` + `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` → renew→checkout flow.
- **Paystack webhook URL:** point Paystack at `/api/paystack/webhook` (verifies
  HMAC-SHA512 signature, idempotent on reference).

Notes:
- `public.support_tickets` table added (RLS: platform-admin all / gym-staff own).
- Coach 6-week earnings sparkline, superadmin MRR trend + plan-mix are now
  computed from real history (instructor_subscriptions / platform_payments / gyms).
- Superadmin gyms/members/audit search + filter chips are wired (URL `?q`/`?f`).
- `typedRoutes` re-enabled in `next.config.ts` (every linked route exists).
- RLS helper functions not used by any policy (get_current_gym_id, get_my_profile_id,
  get_user_gyms, gym_id_from_waiver, is_gym_member, is_gym_owner) had EXECUTE revoked
  from anon/authenticated to drop their PostgREST RPC exposure.
- **Paystack** subscription/renew + webhook → needs `SUPABASE_SERVICE_ROLE_KEY`
  (server-only) set in env; writes go through `lib/supabase/admin.ts`.
- **Subdomain** multi-tenancy in `middleware.ts` if multi-gym selection is wanted
  (DAL currently resolves the user's gym from their links).

> Note: gating means previewing now needs a real login — sign up at `/signup`
> or seed a test member. The `SET SERVICE_ROLE` key is required for Paystack/
> cron/admin write paths (`lib/supabase/admin.ts`).

## ✅ Done (built from scratch, on `main`, build + tsc green)

**Foundation**
- `package.json` (Next 16 · React 19 · Tailwind v4 · TS 5.9 · lucide-react), `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `.gitignore`
- `app/globals.css` — consolidated from the bundle: tokens (`colors_and_type.css`) + `gf-*` components (`gymflow.css`) + base shell (`revamp.css`) + popup system (`ui.css`) + marketing (`marketing.css`) + features inline + auth (`auth.css`). All `../assets/` url()s rewritten to `/images/`.
- `app/layout.tsx` — root, fonts, `data-theme="dark"`, metadata
- `public/images/*` — gym photography + logos
- `components/marketing/chrome.tsx` — `MarketingNav` + `MarketingFooter`

**Marketing (8 routes)** — `/`, `/features`, `/about`, `/pricing`, `/contact`, `/careers`, `/legal`, `/gallery`

**Auth (4 routes)** — `/login`, `/signup` (login in "create gym" mode), `/forgot-password`, `/reset-password` (live strength meter). Client components; no backend (prototypes are backendless too).

**Member PWA (8 routes)** ✅ — `member.css` namespaced under `.ds-member` (device chrome stripped); `components/member/tabbar.tsx` + `app/(member)/layout.tsx`. Routes: `/dashboard`, `/classes`, `/checkin`, `/dashboard/wallet` + `/wallet/[id]`, `/dashboard/renew`, `/dashboard/inbox`, `/dashboard/profile`.

**Admin (11 routes + shell)** ✅ — admin.css + all 11 `admin*.html` inline styles namespaced under `.ds-admin`; `components/admin/admin-shell.tsx` + `app/(admin)/layout.tsx`. Routes: dashboard, members, staff-checkin, analytics, classes, instructors, pricing, reminders, operations, wallet, settings.

## ⬜ Remaining app surfaces (each = its own session)

> **Recipe is proven** (member + admin done). For each: extract the surface's
> inline `<style>` blocks, namespace under `.ds-admin` (they reuse admin's
> KPI/panel/table primitives), build a shell + the pages with static data.
> Reuse the namespacing node script pattern from the admin commit.

The pattern is established: per surface, (1) namespace its CSS, (2) build each
view as a route reproducing the matching `revamp/*.html`.

### Member PWA — `revamp/member.html` (9 views)
- **CSS:** `design/revamp/member.css` (499 lines). **Strip the prototype device chrome** (`.fitbox`, `.controls`, `.seg-ctrl`, `.device`, `.theme-btn`, `.statusbar`, the body phone-frame background) — those are preview-only. **Namespace the real UI rules under `.ds-member`** (they collide with admin's bare `.switch`/`.group`/`.row`/`.method`/`.sect-t`/`.cls-list`). Wrap every member page in `<div className="ds-member">`.
- **Routes** (match the prototype's view names): `/dashboard` (home: `.mhead`/`.status`/`.qa`/`.week`/`.stat3`/`.lc`/`.promo`), `/classes` (schedule: `.segtabs`/`.calstrip`/`.cls-card`/`.bkg`), `/checkin` (`.ci`/`.qr`/`.ci-btn`), `/dashboard/wallet` (`.wcard`/`.spend`/`.txn`), `/dashboard/wallet/[id]` (receipt: `.receipt`/`.rtop`/`.rlist`), `/dashboard/renew` (`.rplan`/`.paysafe`), `/dashboard/inbox` (notifications: `.notif-group`/`.notif`/`.nic`), `/dashboard/profile` (`.prof-top`/`.prof-stats`/`.group`/`.row`). Mobile bottom tab-bar layout wraps them.

### Admin — `revamp/admin*.html` (11 pages)
- **CSS:** mostly inline `<style>` per `admin*.html` file + `revamp/admin.css`. Namespace under `.ds-admin`. (Base shell `.app`/`.gf-sidebar`/`.top`/`.content`/`.panel`/`.icon-btn`/`.search` already in globals from `revamp.css`.)
- **Sidebar/shell:** build an `AdminShell` client component (sidebar nav + topbar) — see `design/` for the prototype's nav order: Overview · Members · Check-In · Analytics · Classes · Staff · Pricing · Reminders · Facility · Wallet · Settings.
- **Routes:** `admin.html`→`/admin/dashboard`, `admin-members`, `admin-checkin`→`/admin/staff-checkin`, `admin-analytics`, `admin-classes`, `admin-staff`→`/admin/instructors`, `admin-pricing`, `admin-reminders`, `admin-facility`→`/admin/operations`, `admin-wallet`, `admin-settings`.

### Instructor portal — `revamp/instructor*.html` (7 pages)
- Shares `.ds-admin` primitives + instructor-only widgets (`.tl`/`.tl-card` timeline, `.roster`, `.cl-row`, `.ec` chart, `.payout`). Routes: schedule · classes · clients · attendance · earnings · payouts · settings.

### Superadmin — `revamp/superadmin*.html` (8 pages)
- Shares `.ds-admin` + super-only widgets (`.gt`/`.gname`, `.act-row`, `.dstat`, `.pill-plat`). Routes: overview · gyms · members · revenue · onboard · audit · support · settings.

### Backend (separate track)
Prototypes use fake data. To make it a real product, wire Supabase (auth + RLS
+ multi-tenant by subdomain via `proxy.ts`) and Paystack — see `design/HANDOFF.md`
§5 for the module list. `typedRoutes` is enabled in `next.config.ts`.

## Commands
```
npm install
npm run build      # verify every route compiles + prerenders
npx tsc --noEmit
```

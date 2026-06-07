# GymFlow rebuild — progress & continuation

Building the project from scratch from the design bundle (`design/`), exactly
as the `revamp/*.html` prototypes specify. Tracking what's done and the recipe
for what's left.

> **✅ VISUAL REBUILD COMPLETE.** All 6 surfaces (48 routes) are built from
> `revamp/*.html`, building + prerendering, tsc/lint clean. Pages use the
> prototypes' static data. **Next track: backend** — wire Supabase (auth +
> RLS + multi-tenant subdomains) and Paystack so the static UIs become a real
> product. See `design/HANDOFF.md` §5 for the module list. Re-enable
> `typedRoutes` in `next.config.ts` once routes are stable.

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

Data-wired so far:
- **Member: ALL 8 pages.**
- **Admin: 10/11** — all except analytics (KPIs easy; chart series need aggregation).
- **Coach: 4/7** — today, clients, earnings, payouts. (classes, attendance, settings remain.)
- **Superadmin: 5/8** — overview, gyms, members, revenue, audit. (onboard, support, settings remain.)

Still to wire / finish:
- Admin: analytics chart series (revenue/check-ins/growth aggregation).
- Coach: classes (instructor's own schedule), attendance (mark instructor_sessions — a write), settings (instructor profile form + update action).
- Superadmin: onboard (provision form → create gym + owner; needs SERVICE_ROLE), support (no tickets table — leave sample or add one), settings (platform config — mostly static).
- **Paystack** charge flow (renew/subscribe) + webhook → SERVICE_ROLE_KEY + Paystack keys.
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
§5 for the module list. `typedRoutes` is off in `next.config.ts` until every
linked route exists; re-enable then.

## Commands
```
npm install
npm run build      # verify every route compiles + prerenders
npx tsc --noEmit
```

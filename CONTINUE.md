# GymFlow rebuild — progress & continuation

Building the project from scratch from the design bundle (`design/`), exactly
as the `revamp/*.html` prototypes specify. Tracking what's done and the recipe
for what's left.

> **Priority (set by the user): VISUALS FIRST.** Build every surface's UI to
> pixel-faithful completeness against `revamp/*.html` before any backend.
> Pages may use the prototypes' static/fake data for now — Supabase + Paystack
> wiring is a deliberate later track. Order: Member PWA → Admin → Instructor →
> Superadmin, then backend.

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

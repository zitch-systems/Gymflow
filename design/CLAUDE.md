# CLAUDE.md — GymFlow continuation guide

> Read this first. It orients you (Claude Code) to continue building GymFlow from a
> verified design source. **The `revamp/` HTML files are the spec; the `app/` Next.js
> files are the partial implementation you are extending.**

---

## 0. ⚠️ THE ONE RULE — build the NEW interface, not the old one

This project is a **redesign**. There are two distinct UIs in play and you must not confuse them:

- **`revamp/*.html` = the NEW interface.** This is the ✅ authoritative spec for **how every
  screen looks, behaves, is laid out, and is worded.** When you build any route, open the
  matching `revamp/<name>.html` and reproduce *that*. This is your only visual target.
- **`github.com/zitch-systems/Gymflow` (the production repo) = the OLD interface + the backend.**
  Its **shipped UI is what we are replacing — DO NOT reproduce it, port it, or take visual/
  layout/copy cues from it.** Consult the repo ONLY for non-visual plumbing:
  data shapes, Supabase/RLS gates, Paystack flows, server actions, and the **names** of
  existing `gf-*` classes / `@/lib` modules so your wiring matches.

**If the repo's current screen and `revamp/<name>.html` disagree on anything you can see
(layout, hierarchy, components, copy, states) — `revamp/` wins, every time.** The repo is
behind; that's the entire reason this redesign exists. Never "match the existing screen."

> Quick test before you write a component: *"Am I copying what GymFlow looks like today?"*
> If yes, stop — open the `revamp/` file and copy that instead.

---

## 1. What this project is

**GymFlow** — a multi-tenant gym-management SaaS for Nigerian fitness businesses
(branded subdomain per gym, e.g. `powerhouse.gymflow.ng`). Members, QR check-in, class
booking, Paystack subscriptions, automated reminders, analytics; installable PWA.

- **Backend & conventions source (NOT visual):** `github.com/zitch-systems/Gymflow` — Next.js 16
  (App Router, React 19), Supabase (Postgres + RLS), Paystack (Naira), Tailwind v4 +
  custom `gf-*` CSS, multi-tenant by subdomain. Use it for data/auth/payments/class-names
  only — **its shipped UI is the OLD design we are replacing (see §0).**
- **This bundle** is the **design system + a fully-built, verified HTML prototype** of
  every surface, plus a **partial port** of the marketing site into real Next.js routes.

## 2. Repo layout

| Path | What it is | Status |
|---|---|---|
| `revamp/*.html` | **The spec.** Interactive, pixel-faithful prototype of every screen. All verified working. | ✅ complete |
| `colors_and_type.css` | Design tokens (color, type, spacing, radius, shadow, motion) as CSS vars + utilities | reference |
| `gymflow.css` | The faithful `gf-*` component library | reference |
| `app/globals.css` | The **real app's** stylesheet — mirrors `gf-*` + marketing classes. Use these class names. | ground truth |
| `app/admin.css` | Real app admin styles | ground truth |
| `app/(platform)/` | Marketing routes: `page.tsx` (/), `about/`, `features/`, `pricing/` | partial |
| `app/gym/[slug]/admin/admin-shell.tsx` | Real admin sidebar/topbar shell (client component) | reference |
| `components/marketing/` | `nav.tsx`, `footer.tsx`, `sections.tsx` (FeatureCard/Step/Testimonial/Faq) | done |
| `assets/`, `public/images/` | Logo (Momentum mark, wordmarks, app icon) + real gym photography | done |
| `preview/` | 24 design-system spec cards | reference |
| `README.md` / `HANDOFF.md` | Brand context, voice, visual rules, screen index | read |

## 3. How to work here

1. **Pick a screen** from the prototype (`revamp/<name>.html`) — open it in a browser to
   see the exact intended look, copy, and interactions.
2. **Recreate it as a Next.js route**, reproducing the `revamp/` screen's look, layout, and
   copy. Use the **already-ported** routes for *code* conventions only (file structure,
   imports, how `gf-*` classes are applied) — `app/(platform)/page.tsx`, `about/page.tsx`,
   `features/page.tsx`, `pricing/page.tsx`. These were themselves built from `revamp/`, so
   they're safe models; do **not** instead mirror the equivalent screen in the production repo.
3. **Use the real class names** from `app/globals.css` (e.g. `gf-btn`, `gf-card`,
   `marketing-hero`, `mk-steps`, `mk-gallery`, `gf-sidebar`, `gf-nav-item`, `kpi`…).
   Do **not** invent classes — grep `globals.css` first.
4. **Icons:** `lucide-react`, `strokeWidth={1.75}`. **Images:** `next/image` from
   `public/images/*`. **Money glyph:** `₦`.
5. **Voice:** Nigerian, confident, concrete, second-person (see README "Content
   Fundamentals"). Reuse the prototype's exact copy where possible.

## 4. Build status — routes

### Marketing (`app/(platform)/`)
| Route | Prototype | Status |
|---|---|---|
| `/` | `revamp/marketing.html` | ✅ built (`page.tsx`) |
| `/about` (nav label "Gallery") | `revamp/about.html` + `gallery.html` | ✅ built (`about/page.tsx`) |
| `/features` | `revamp/features.html` | ✅ exists |
| `/pricing` | `revamp/pricing` section | ✅ exists |
| `/contact` | `revamp/contact.html` | ⬜ TODO (footer uses `#contact` anchor today) |
| `/careers` | `revamp/careers.html` | ⬜ TODO |
| `/legal` | `revamp/legal.html` | ⬜ TODO |

### Auth — ⬜ TODO (needs `@/lib/auth/actions`)
| Route | Prototype |
|---|---|
| `/login` | `revamp/login.html` |
| `/signup` / `/join` | `revamp/login.html` (Create-gym tab) |
| `/forgot-password`, `/reset-password` | `revamp/forgot-password.html`, `reset-password.html` |

### Member PWA — ⬜ TODO (`app/(member)/` or `app/[slug]/`)
`revamp/member.html` — home · schedule · class detail · check-in · wallet · receipt ·
renew (Paystack) · notifications · profile. Mobile-first.

### Admin (`app/gym/[slug]/admin/*`) — ⬜ TODO, shell exists
Prototype pages → routes (see `admin-shell.tsx` NAV array for real hrefs):
`admin.html`→dashboard · `admin-members.html`→members · `admin-checkin.html`→staff-checkin ·
`admin-analytics.html` · `admin-classes.html` · `admin-staff.html`→instructors ·
`admin-pricing.html` · `admin-reminders.html` · `admin-facility.html`→operations ·
`admin-wallet.html` · `admin-settings.html`. (Real shell also has PT Packs, Announcements,
Hours, Waiver, Audit, Payouts, Billing — design those from the closest prototype.)

### Instructor portal — ⬜ TODO
`revamp/instructor*.html` — schedule · classes · clients · attendance · earnings · payouts · settings.

### Superadmin — ⬜ TODO
`revamp/superadmin*.html` — overview · gyms · members · revenue · onboard · audit · support · settings.

## 5. Dependencies you must pull from the real repo

The product-app routes reference modules **not in this snapshot** — import them from
`github.com/zitch-systems/Gymflow` before building those screens:

- `@/lib/auth/actions` (`signOut`, sign-in/up server actions) · `@/lib/theme`
  (`ThemeToggleButton`)
- `@/components/ui/logo` (`LogoMark`) · `@/components/ui/command-palette`
  (`CommandPalette`)
- `@/lib/actions/search-members` · `@/lib/platform-pricing`
  (`PLATFORM_PRICING`, `BILLING_PERIODS`, `formatNaira`, `periodSavings`)
- Supabase client + `requireStaff(slug)` / RLS gates, Paystack integration.

**Do not stub these silently** — wire to the real implementations so auth, tenancy, and
payments stay correct.

## 6. Design tokens (summary — authoritative values in `colors_and_type.css` / `app/globals.css`)

- **Brand emerald** `#11d18b` (light `#4fe3a8`, dark `#07a86c`) · **accent volt-lime** `#c6f24e`
- **Dark surfaces:** bg `#0a0a12`, surface `#12121e`, elevated `#1b1b2b`, border `#2a2a40`;
  full light theme via `[data-theme="light"]`
- **Text:** `#f3f3fa` / `#9b9bb8` / `#6a6a86`
- **Semantic:** success `#00c896`, warning `#ffb020`, danger `#ff4560`, info `#4080ff`
- **Radius** 8/12/16/20/24/999 · **Type:** Plus Jakarta Sans (display 700–800), Inter (body),
  JetBrains Mono (numbers) · **Motion** 120/220/380ms

## 7. Fidelity & rules

- **High-fidelity.** Recreate pixel-faithfully — final colors, type, spacing, radii,
  shadows, motion and copy are all specified. The `gf-*` names mirror the real app, so
  most markup maps directly onto existing components.
- These prototypes use **fake data and no backend** — wire to real Supabase/Paystack data.
- No emoji in chrome; Lucide only. Follow README "Visual Foundations" + "Content Fundamentals".

## 8. Commands (in the real repo)

```bash
pnpm install
pnpm dev          # next dev
pnpm build        # verify the routes added here compile
pnpm lint
```

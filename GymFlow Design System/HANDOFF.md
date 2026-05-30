# Handoff: GymFlow — Design System & End-to-End Revamp

## Overview
This bundle is the **GymFlow design system** plus a **full UI revamp** (new identity) covering every product surface: marketing site, auth, the member PWA, the gym-owner admin console, the instructor portal, and the superadmin platform. GymFlow is a multi-tenant gym-management SaaS for Nigerian fitness businesses (Next.js 16 + Supabase + Paystack, subdomain-per-gym, PWA).

## About the design files
The files here are **design references created in HTML/CSS/JS** — interactive prototypes that show the intended look, copy, and behavior. They are **not production code to ship directly**. The task is to **recreate these designs in the target codebase** (the live app is Next.js 16 / React 19 with a Tailwind v4 + custom `gf-*` CSS system) using its established patterns — or, for a greenfield surface, to pick the appropriate framework and implement them there. The original source of truth is `github.com/zitch-systems/Gymflow` (`app/globals.css`).

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, shadows, motion and copy are all specified in `colors_and_type.css` / `gymflow.css`. Recreate pixel-faithfully. The `gf-*` class names mirror the real app, so most markup maps directly onto existing components.

## File map
| Path | What it is |
|---|---|
| `README.md` | **Read first** — brand context, sources, Content Fundamentals (voice), Visual Foundations (look & feel rules), Iconography, full index |
| `colors_and_type.css` | All design tokens (color, type, spacing, radius, shadow, motion) as CSS vars + semantic type utilities; imports the 3 Google fonts |
| `gymflow.css` | The faithful `gf-*` component library (buttons, cards, badges, inputs, sidebar, nav, KPI, table, avatar, chips, dropdown) |
| `SKILL.md` | Brand-expert summary / Agent-Skill front-matter |
| `assets/` | New **Momentum** logo (SVG mark, light/dark wordmarks, 4K PNGs, 1024 app icon), original loop logo (reference), real gym photography |
| `preview/` | 24 design-system spec cards (color, type, spacing, components, brand) |
| `revamp/` | The interactive UI kit — every screen below |

## Screens (in `revamp/`)
All share the brand foundation (`revamp.css` → `gymflow.css` → `colors_and_type.css`), Lucide icons (CDN), and a floating role-switcher (`proto.js`). Cross-surface link/button feedback is in `wire.js`; the admin sidebar/topbar is rendered by `admin-shell.js`.

- **`index.html`** — hub linking all surfaces + identity showcase
- **`marketing.html`** — public landing: photo hero, trust strip, features, how-it-works, gallery, pricing (3 tiers), testimonials, CTA, footer
- **`features.html`** — categorized feature deep-dive (Members / Payments / Classes / Operations), alternating image-text rows
- **`login.html`** — split brand panel + sign-in / create-gym tabs + role quick-access
- **`member.html`** — member PWA in a phone frame: Home (status, quick actions, next class, recent check-ins), QR Check-in (tap-to-check-in success), Classes list → **class detail → booking confirmation**, **Renew → plan picker → Paystack checkout → success**, Profile
- **`admin.html`** — owner dashboard: greeting, range switch (Today/Week/Month re-computes all KPIs), KPI cards + sparklines, revenue bar chart, live check-in feed (Simulate), needs-attention rail, today's classes, members table + search + Add-member modal, theme toggle
- **`admin-members.html`** — filterable members table + detail **drawer**
- **`admin-checkin.html`** — search-to-check-in with suggestions + animated live feed
- **`admin-analytics.html`** — revenue area chart, plan-mix donut, check-ins & growth bars, date-range
- **`admin-classes.html`** — week day-picker, per-class capacity bars, waitlist/full states
- **`admin-pricing.html`** — plan cards with MRR per plan
- **`admin-reminders.html`** — expiring list with send actions + delivery log
- **`admin-wallet.html`** — balance, withdraw/payout, transactions table
- **`admin-settings.html`** — sub-navigated: profile, branding, business hours, notifications (toggles), integrations, team
- **`instructor.html`** — schedule timeline, PT clients, earnings, payouts; class **roster drawer**
- **`superadmin.html`** — platform overview: KPIs, MRR area chart, activity feed, gyms table + gym **drawer**
- **`superadmin-gyms.html`** — full gyms list: filter chips, search, gym detail **drawer**

## Design tokens
Authoritative values live in `colors_and_type.css`. Summary:
- **Brand emerald** `#11d18b` (light `#4fe3a8`, dark `#07a86c`); **accent volt-lime** `#c6f24e`
- **Dark surfaces** bg `#0a0a12`, surface `#12121e`, elevated `#1b1b2b`, border `#2a2a40`; full **light theme** via `[data-theme="light"]`
- **Text** `#f3f3fa` / `#9b9bb8` / `#6a6a86` / `#3c3c54`
- **Semantic** success `#00c896`, warning `#ffb020`, danger `#ff4560`, info `#4080ff`
- **Radius** 8 / 12 / 16 / 20 / 24 / 999px · **Shadows** xs→lg + brand glow `0 0 40px rgba(17,209,139,.2)`
- **Type** Plus Jakarta Sans (display 700–800), Inter (body), JetBrains Mono (numbers); fluid `clamp()` scales
- **Motion** 120 / 220 / 380ms; eases standard `(.4,0,.2,1)`, out `(.22,1,.36,1)`, spring `(.34,1.56,.64,1)`

## Interactions & behavior
Documented per-screen above; key patterns: right-side **drawers** (`transform: translateX` slide, 380ms), **toasts** (spring pop, `.toast`), modal overlays, segmented range switches that re-render KPI/chart data, client-side search/filter, and view-switching in the phone PWA. Membership status vocabulary: **Active / Expiring / Expired / Paused**, **Past due**, **Trial**.

## Assets & iconography
- Icons: **Lucide** only (`lucide@latest` UMD here; `lucide-react` in the app), ~1.75 stroke. No emoji in chrome. `₦` is the one meaningful unicode glyph.
- Logo: new **Momentum** mark in `assets/` (use by default); original loop mark kept for reference. Photography in `assets/gym-*.jpg`.

## Notes
- These are front-end mocks with fake data and no backend — wire to real Supabase/Paystack data in implementation.
- The `gf-*` system here mirrors the codebase's `app/globals.css`; prefer reusing/extending those existing classes over re-deriving styles.
- Voice & rules: follow **Content Fundamentals** and **Visual Foundations** in `README.md`.

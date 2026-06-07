# GymFlow — Design System

A design system for **GymFlow**, a modern, multi-tenant **gym-management SaaS built for Nigerian fitness businesses**. Each gym gets a branded subdomain (`powerhouse.gymflow.ng`) with member management, QR check-in, class scheduling, automated reminders, Paystack subscriptions, and analytics — all installable as a PWA.

This repository packages the brand foundations (color, type, spacing, motion), the real component library, brand assets, and high-fidelity interactive recreations so any designer or agent can produce on-brand GymFlow work.

---

## Sources

Everything here was reverse-engineered from the product's source of truth — read these for deeper fidelity:

- **GitHub:** [`github.com/zitch-systems/Gymflow`](https://github.com/zitch-systems/Gymflow) — Next.js 16 + Supabase + Paystack app. The design system lives in `app/globals.css` (~4,200 lines of `gf-*` tokens + components) and `app/admin.css`.
- Stack: Next.js 16 (App Router, React 19), Supabase (Postgres + RLS), Paystack (Naira subscriptions), Tailwind v4 + custom `gf-*` system, PWA.
- Multi-tenant by subdomain; `proxy.ts` rewrites `{slug}.gymflow.ng` → gym routes.

> The repo README describes a "violet + Space Grotesk" palette, but the **shipping CSS is the source of truth**: emerald + volt-lime, Plus Jakarta Sans. This system follows the code.

### Products / surfaces

| Surface | Who | Notes |
|---|---|---|
| **Marketing site** | Public | `/`, `/features`, `/pricing`, `/about` — photo-led hero, conversion-focused |
| **Auth & onboarding** | Public | `/login`, `/signup`, `/join` |
| **Member app (PWA)** | Members | `/dashboard`, `/checkin`, `/classes`, `/renew` — mobile-first |
| **Admin dashboard** | Gym staff (owner / manager / front desk / accountant) | `/admin/*` — members, analytics, classes, pricing, reminders, settings… |
| **Instructor portal** | Instructors | own schedule, PT clients, earnings, payouts |
| **Superadmin** | Platform admins | all gyms, platform MRR, audit |

---

## Brand at a glance

- **Primary — Emerald** `#11d18b` (dark / `#08a86c` light). Energetic, healthy, "go".
- **Accent — Volt lime** `#c6f24e`. High-energy highlight, used sparingly (peaks, CTAs, the logo spark).
- **Dark-first.** Near-black with a cool violet undertone (`#0a0a12`). A light theme exists via `[data-theme="light"]`.
- **Type:** Plus Jakarta Sans (display, 700–800), Inter (body), JetBrains Mono (numerics / code).
- **Shape:** generous rounding (12–24px), pill chips/badges, soft elevation + brand glow.
- **Icons:** [Lucide](https://lucide.dev), ~1.75 stroke.
- **Voice:** Nigerian, confident, concrete, second-person.

---

## CONTENT FUNDAMENTALS

How GymFlow writes.

- **Voice:** direct, confident, practical — never hypey or corporate. It speaks like a peer who runs gyms, not a SaaS brochure.
- **Person:** second person ("**your** gym", "**you**"). Owners and members are always "you"; the product is "GymFlow", rarely "we".
- **Casing:** sentence case everywhere — headings, buttons, nav. Only ALL-CAPS use is small eyebrow/label text with wide tracking (e.g. `BUILT IN LAGOS`, KPI labels). Never title-case headlines.
- **Tone:** outcome-first and time-bound. Leads with the benefit, then the proof.
  - *"Run your gym the modern way."*
  - *"Live in an afternoon."* / *"Launch your gym in an afternoon."*
  - *"Auto-debit alone paid for itself in the first week."*
- **Local & concrete:** unapologetically Nigerian. Naira (`₦`) with no FX hedging, real cities (Lagos, Abuja, Port Harcourt), local tools (Paystack, WhatsApp, Termii). *"built light enough to run smoothly on Nigerian networks."*
- **Numbers:** Naira amounts use the `₦` glyph and thousands separators — `₦13,999/mo`, `₦5.8M`. Tabular figures for any aligned numeric column.
- **Buttons:** verb-led and specific — *Launch your gym*, *Add member*, *See pricing*, *Remind*, *Choose Growth*. Avoid generic *Submit / Click here*.
- **Microcopy:** warm and human in member-facing surfaces (*"You're in!"*, *"Hi, Tunde"*), crisp and factual in admin (*"3 memberships need attention"*).
- **Emoji:** essentially none in product chrome. A single waving 👋 in the member greeting is the ceiling — treat emoji as off by default; iconography carries meaning instead.
- **Status language:** consistent membership vocabulary — **Active / Expiring / Expired / Paused**, **Past due**, **Trial**.

---

## VISUAL FOUNDATIONS

The look and feel, and the rules behind it.

**Palette & mood.** Dark-first, near-black canvas (`#0a0a12`) with a faint violet undertone and layered surfaces (`surface #12121e`, `elevated #1b1b2b`). Emerald is the single hero hue; volt-lime is the rare spark. Color is used with restraint — most of a screen is neutral, and brand green marks the one thing that matters (active state, primary action, a peak in a chart). A full light theme mirrors every token.

**Typography.** Plus Jakarta Sans carries all display/heading/number weight (700–800, tight negative tracking down to `-0.045em` on the big display). Inter handles body copy at comfortable 1.5–1.6 line-height. JetBrains Mono for codes/kbd. Fluid `clamp()` scales from hero (`4.5rem`) to micro-labels (`0.6875rem`, uppercase, `+0.07em` tracking).

**Spacing & radius.** 8-px rhythm. Radii: `xs 8 · sm 12 · base 16 · lg 20 · xl 24 · pill 999`. Cards and inputs land at 12–16px; modals/big surfaces at 20–24px; chips, badges and avatars are fully pill/round.

**Backgrounds.** Three moves: (1) **photographic** — real gym imagery, dimmed to ~0.20–0.28 opacity behind heroes/auth with a gradient scrim to keep text legible; (2) **radial brand wash** — a soft emerald glow `radial-gradient(... var(--gf-brand-soft) ...)` at the top of marketing/auth; (3) **flat surface** for app chrome. No busy patterns, no noise/grain.

**Elevation & glow.** Two stacked systems: ordinary dark shadows (`xs→lg`, rising opacity) **and** a brand **glow** (`0 0 40px rgba(17,209,139,.2)`) reserved for the primary CTA, focused/active brand elements, and "popular" cards. Glow is an accent, not a default.

**Cards.** `surface` fill, `1px` `border` (`#2a2a40`), 16px radius, ~20px padding. Hover lifts ~2–3px and brightens the border to `border-light` (sometimes to a brand-glow border). Elevated variant uses the lighter `elevated` fill.

**Borders & dividers.** Hairline `1px` in `border`/`border-light`; section dividers are the same. Focus rings are `brand` border + a 3px `brand-soft` halo.

**Buttons.** Primary = emerald **gradient** (`135deg light→dark`) with an inner top highlight and brand glow; hover lifts `-2px` and deepens the glow; press `scale(0.97)`. Variants: accent (volt-lime, dark text), secondary (elevated + border), ghost, outline (brand border), danger (red gradient). Sizes sm→xl, plus square icon buttons.

**Inputs.** `elevated` fill, `1.5px` border, 12px radius; focus → brand border + soft halo + surface fill. Specials: leading-icon group, and a `₦` Naira-prefixed input.

**Motion.** Purposeful and quick. Standard `220ms`, fast `120ms`, slow `380ms`. Easings: standard `cubic-bezier(.4,0,.2,1)`, an **out** `(.22,1,.36,1)` for entrances, and a **spring** `(.34,1.56,.64,1)` for playful pop (toasts, modals, check-in success). Active states pulse the status dot. No long or decorative animation.

**Hover / press.** Hover = brighter border + subtle `translateY(-1…-3px)` lift (and/or color shift to brand). Press = `scale(0.96–0.97)`. Nav-active = brand-soft gradient wash with an inset 2px brand bar and a glowing icon.

**Transparency & blur.** Sticky bars and glass surfaces use `backdrop-filter: blur(12–20px) saturate(1.4–1.8)` over a `color-mix`/rgba tint. Overlays dim to `rgba(0,0,0,.5)` with a light blur.

**Imagery.** Real, warm, well-lit gym photography (equipment, studios, kettlebells, bikes). Shot in portrait `3:4` for galleries; dimmed + scrimmed behind text. No illustration system, no stock-y gradients-as-imagery.

**Data viz.** Emerald gradient bars (rounded tops), emerald area charts with a fading fill, donuts using brand → blue → volt-lime, and tiny inline sparklines on KPI cards. Warnings shift to amber. Tabular numerics throughout.

---

## ICONOGRAPHY

- **System:** [**Lucide**](https://lucide.dev) (`lucide-react` in the app; `lucide@latest` UMD in these static files). It is the *only* icon set — consistent 24×24 grid, rounded caps/joins.
- **Stroke & size:** stroke weight **1.75** is the house default (occasionally 2 for tiny glyphs, 2.6 inside the logo). Sizes: 15–18px inline / in nav, 19–22px in feature & KPI tiles, 13–14px inside badges and delta pills.
- **Color:** icons inherit text color — muted by default, brand-green when active/hovered, semantic colors inside status contexts. Active nav icons get a `drop-shadow` brand glow.
- **Containers:** feature/KPI icons sit in a rounded ~11–14px tile tinted with the relevant `*-soft` color (e.g. `brand-soft` bg + `brand` icon).
- **Common glyphs:** `scan-line` (check-in), `credit-card` (Paystack), `calendar-days` (classes), `users`, `bar-chart-3`, `wallet`, `bell`, `dumbbell`, `graduation-cap` (instructor), `shield-check` (platform), `building-2` (gym).
- **Emoji / unicode:** not an icon system. The `₦` Naira sign is the one meaningful unicode glyph (used as an input prefix and in copy). Avoid emoji in product chrome.
- **Logo:** the new **"Momentum"** mark — three forward-leaning ascending bars with a volt-lime peak in an emerald squircle. See `assets/` (SVG mark, light/dark wordmarks, 4K PNGs, 1024 app icon). The original product mark (a circular "loop" glyph) is preserved in `assets/logomark.svg` for reference.

---

## What's in this repo (index)

**Foundations**
- `colors_and_type.css` — all design tokens (color, type, spacing, radius, shadow, motion) as CSS vars + semantic type utilities. Imports the three Google fonts.
- `gymflow.css` — the faithful `gf-*` component library (buttons, cards, badges, inputs, sidebar, nav, KPI, table, avatar, dropdown, chips…). Imports `colors_and_type.css`.

**Brand assets — `assets/`**
- `logomark-v2.svg`, `logo-wordmark-v2-{dark,light}.svg` — new Momentum logo
- `gymflow-logo-v2-4k.png` (+ `-transparent`), `gymflow-appicon-v2-1024.png` — hi-res exports
- `gymflow-logo-4k.png`, `logomark.svg`, … — original loop logo (reference)
- `gym-*.jpg` — real gym photography (hero, studio, kettlebells, bikes, barbell, machines…)

**Design System tab — `preview/`**
- Small spec cards for color, type, spacing, components and brand. These populate the Design System tab.

**Interactive UI kit — `revamp/` (the visual spec)**
- A high-fidelity, **interactive recreation of the whole product** under the new identity, with a floating role-switcher: `index.html` (hub), `marketing.html`, `login.html`, `member.html`, `admin.html` (+ `admin-members`, `admin-analytics`, `admin-classes`, `admin-pricing`, `admin-settings`), `instructor.html`, `superadmin.html`. Shared shell in `admin-shell.js`, `proto.js`; styles in `revamp.css` + `admin.css`. **This is the authoritative look/UX/copy spec for every screen — build new routes to match these, not the old shipped UI.**

**`SKILL.md`** — makes this folder usable as an Agent Skill.

---

## Using it

1. Link the foundations: `<link rel="stylesheet" href="gymflow.css">` (it pulls in tokens + fonts).
2. Reach for `gf-*` classes for components, or lift markup from `revamp/`.
3. Pull brand assets from `assets/`. Use the new Momentum logo by default.
4. Match the voice (CONTENT FUNDAMENTALS) and the rules (VISUAL FOUNDATIONS).
5. Icons via Lucide CDN: `<script src="https://unpkg.com/lucide@latest"></script>` then `lucide.createIcons()`.

> Want to go deeper than this system captures? Read the source at **github.com/zitch-systems/Gymflow** — the `gf-*` system in `app/globals.css` is the ground truth **for class names and tokens**. It is *not* a visual reference: the repo's currently-shipped screens are the OLD design. For how a screen should look, the `revamp/` prototype is authoritative.

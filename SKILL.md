---
name: gymflow-design
description: Use this skill to generate well-branded interfaces and assets for GymFlow — a modern gym-management SaaS for Nigerian fitness businesses — for production or for throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, brand assets, and an interactive UI kit for prototyping across the marketing site, member PWA, admin dashboard, instructor portal and superadmin console.
user-invocable: true
---

# GymFlow design skill

Read **`README.md`** first — it carries the full brand context, sources, CONTENT FUNDAMENTALS (voice), VISUAL FOUNDATIONS (look & feel), ICONOGRAPHY, and a file index. Then explore the other files as needed.

## What's here
- **`colors_and_type.css`** — all design tokens (color, type, spacing, radius, shadow, motion) as CSS vars + semantic type utilities; imports the three Google fonts. Link this (or `gymflow.css`) and you get the whole brand.
- **`gymflow.css`** — the faithful `gf-*` component library (buttons, cards, badges, inputs, sidebar, nav, KPI, table, avatar, chips, dropdowns…). Imports `colors_and_type.css`.
- **`assets/`** — logos (new "Momentum" mark: `logomark-v2.svg`, wordmarks, 4K PNGs, 1024 app icon; original loop mark kept for reference), and real gym photography (`gym-*.jpg`).
- **`revamp/`** — an interactive, high-fidelity recreation of the **whole product** (marketing, login, member PWA, admin + 5 sub-pages, instructor, superadmin) with a role-switcher. This is the living UI kit — copy components and patterns from here.
- **`preview/`** — small spec cards (color, type, spacing, components, brand).

## How to work
- **Visual artifacts** (slides, mocks, throwaway prototypes): copy the assets and CSS you need into static HTML files the user can open. Link `gymflow.css`, lift markup from `revamp/`, pull images/logos from `assets/`, and load icons via Lucide CDN (`https://unpkg.com/lucide@latest` → `lucide.createIcons()`).
- **Production code**: read the rules here to become an expert in the brand, then apply the `gf-*` tokens/classes (or the equivalents in the user's codebase — the system mirrors `app/globals.css` in `github.com/zitch-systems/Gymflow`).

## Non-negotiables
- **Dark-first.** Near-black canvas; emerald `#11d18b` is the one hero hue; volt-lime `#c6f24e` is a rare spark. A light theme exists via `[data-theme="light"]`.
- **Type:** Plus Jakarta Sans (display, 700–800, tight tracking), Inter (body), JetBrains Mono (numbers/codes). Sentence case; uppercase only for small tracked eyebrows/labels.
- **Icons:** Lucide only, ~1.75 stroke. No emoji in product chrome. `₦` is the one meaningful unicode glyph.
- **Voice:** Nigerian, confident, concrete, second-person. Naira pricing, real cities, Paystack/WhatsApp. Verb-led buttons.
- **Restraint:** mostly-neutral screens; brand green marks the one thing that matters. Glow is an accent, not a default. No busy patterns, no stock-y gradients-as-imagery.

If invoked without guidance, ask what the user wants to build, ask a few focused questions, then act as an expert GymFlow designer — outputting HTML artifacts or production code as the need dictates.

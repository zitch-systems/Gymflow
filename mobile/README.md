# GymFlow — Android member app

The React Native (Expo) app for **gym members**. Not staff: there is no admin,
coach or superadmin surface here, and the endpoints it uses only ever resolve
the caller's own membership.

It is the same product as the member PWA at `app/(member)`, on a different
runtime — same palette, same wording, same rules. What the phone adds is the
camera (scan the door QR without opening a browser) and a session that survives
in the Android keystore instead of a cookie.

## What a member can do

| Screen | What it does |
|---|---|
| Gym code → sign in / sign up | Resolve the gym from its member code, then sign in or join |
| Home | Membership status and days left, streak + week grid, visit/class stats, next class, recent check-ins |
| Check in | Scan the door QR, tap to self check-in/out, or take a 6-digit front-desk code (with live countdown, and it flips itself when reception redeems it) |
| Classes | The gym's weekly timetable, book a spot (auto-waitlists when full), and cancel from "My bookings" |
| Wallet | Total spent, six-month spend bars, saved cards, full transaction list, tap through to a receipt |
| Renew | Pick a plan (+ optional private-trainer add-on), pay via Paystack in the system browser |
| Notifications | Reminders, receipts and class alerts, grouped Today / This week / Earlier |
| Profile | Lifetime counts, edit personal + emergency details, links out for waiver/freeze, sign out |

Deliberately **not** in this release: membership freeze requests, waiver
signing and document viewing. Each needs a staff-mediated or signature flow that
exists on the web today; the profile screen links out to the portal for them
rather than shipping half of one.

## Architecture

```
app/api/app/*          ← the JSON API this app talks to (in the Next.js repo)
mobile/src/api         ← client, wire types
mobile/src/auth        ← keystore-backed session + provider
mobile/src/components  ← Screen chrome and the shared UI kit
mobile/src/app         ← expo-router routes
```

**The app holds no Supabase credentials.** It signs in through
`/api/app/signin`, keeps the returned Supabase session in `expo-secure-store`,
and sends it as `Authorization: Bearer <jwt>` on every call. The server binds
that token to a Supabase client, so **RLS is what authorises every read and
write** — exactly as on the web. An access token that expires is refreshed once,
in a single flight, via `/api/app/session`; if that fails the member is returned
to sign-in.

**No business rule is reimplemented here.** Check-in gates, class capacity and
waitlisting, and renewal pricing live in `lib/checkin-core.ts`,
`lib/booking-core.ts` and `lib/renew-core.ts` in the Next.js repo, and the web
Server Actions call the same functions. The app decides what to draw; the server
decides what is allowed.

**Payments never touch the app.** `/api/app/renew` returns a Paystack
authorization URL, which opens in the system browser via
`WebBrowser.openAuthSessionAsync`. Paystack redirects to
`/api/app/pay/callback`, which verifies the charge server-side, fulfils it
(idempotent — the webhook remains the authority) and bounces to
`gymflow://pay/callback`. The app then just refetches.

## Running it

```bash
cd mobile
npm install
cp .env.example .env.local     # point EXPO_PUBLIC_API_URL at your API
npm start                      # then press "a" for Android
```

Expo Go covers most of the app. The camera scanner and `expo-secure-store` need
a development build:

```bash
npx expo run:android           # or: npm run build:android:preview (EAS)
```

Checks:

```bash
npm run type-check
npm run lint
```

The repo's root CI does not build this app — root `tsconfig.json` and
`eslint.config.mjs` both exclude `mobile/`, since Next.js rules don't apply to
React Native. Run the two commands above before pushing changes here.

## Release notes

- Package: `ng.gymflow.member`, scheme `gymflow`, `versionCode` in `app.json`.
- `EXPO_PUBLIC_API_URL` is baked in at build time — set it per profile in
  `eas.json`, not from a developer's `.env.local`.
- Icons are generated from the Flowbell mark, not hand-drawn:
  `node mobile/scripts/generate-icons.mjs` (from the repo root) rewrites
  `assets/images/`. The launcher icon uses the same dark-tile treatment as the
  web favicon (`app/icon.svg`), and the adaptive foreground keeps the mark at
  52% so Android's circle/squircle masking can't clip it. If the mark ever
  changes in `components/ui/logo.tsx`, re-run the script.
- The deep-link scheme is written in two places that must agree:
  `app.json` → `expo.scheme`, and `APP_SCHEME` in
  `app/api/app/pay/callback/route.ts`. A mismatch doesn't lose a payment — the
  member lands on a page with a working "Return to the app" button — but it
  turns a smooth return into a manual one.

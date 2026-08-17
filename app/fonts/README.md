# Fonts

Three variable woff2 files, latin subset, committed on purpose.

| File | Family | Weight range | Used for |
|---|---|---|---|
| `plus-jakarta-sans-latin.woff2` | Plus Jakarta Sans | 400–800 | `--font-display` — headings, buttons, numbers |
| `inter-latin.woff2` | Inter | 400–700 | `--font-body` — everything else |
| `jetbrains-mono-latin.woff2` | JetBrains Mono | 400–600 | `--font-mono` — references, codes, amounts |

Bound to the `--font-*` CSS variables in `app/layout.tsx`, consumed by
`app/globals.css`. ~107 KB for all three.

## Why they're in the repo

They used to be fetched by `next/font/google`. That self-hosts the files at
runtime, but the **build** downloads them from `fonts.gstatic.com` — and Google
rotates the hashed filenames. A Vercel deploy that restored a build cache
holding the old URLs got a 404 for every weight, which surfaced as ~20
`module-not-found` errors in the generated font CSS and failed the build. The
commit that "broke" it had touched no fonts, no CSS and no layout; the same
commit built fine locally and on Cloudflare Pages.

A build that can fail because someone else's CDN moved a file is a build with an
undeclared dependency. These files are that dependency, declared — the same
argument as committing a lockfile.

## Refreshing them

Only needed to pick up a new version of a typeface; there's no expiry.

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# 1. Ask for the variable range you want, with a modern browser UA (older UAs
#    are served ttf/eot rather than woff2).
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&display=swap"

# 2. Take the URL from the /* latin */ block — NOT the first block in the file,
#    which is cyrillic-ext — and save it over the file above.
```

Repeat for `Inter:wght@400..700` and `JetBrains+Mono:wght@400..600`. Keep the
weight ranges in `app/layout.tsx` in step with whatever you download: a range
narrower than the CSS asks for gets synthesised (faux) bold instead of the real
cut.

All three are licensed under the SIL Open Font License 1.1, which permits
bundling and redistribution.
